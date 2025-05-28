import json
import os
import shutil
import logging
import paramiko
import tempfile
import json
import zipfile
import datetime

from app.services.exporter_service import convert_proj_info_to_compose
from app.services.workflow_info_service import WorkflowInfo
from app.utils.exporter_utils import process_opea_services

def deploy_pipeline(hostname, username, pipeline_flow):
    print("[INFO] Starting deployment to remote server...")
    remote_zip_path = f"/home/{username}/docker-compose.zip"
    temp_dir = None
    timestamp = datetime.datetime.now().strftime("%Y%m%d_%H%M%S")
    remote_compose_dir = f"docker-compose-{timestamp}"
    try:
        print("[INFO] Creating ZIP locally...")
        zip_path, temp_dir = create_zip_locally(pipeline_flow, hostname)
        print(f"[INFO] ZIP created at {zip_path}")

        print("[INFO] Connecting to remote server via SSH...")
        ssh = paramiko.SSHClient()
        ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
        ssh.connect(hostname, username=username)
        print("[INFO] SSH connection established.")

        print("[INFO] Opening SFTP session...")
        sftp = ssh.open_sftp()
        print("[INFO] SFTP session opened.")
        sftp.put(zip_path, remote_zip_path)
        print(f"[INFO] ZIP uploaded to {remote_zip_path}")
        sftp.close()
        print("[INFO] SFTP session closed.")

        commands = [
            f"mkdir {remote_compose_dir}",
            f"unzip -o {remote_zip_path} -d {remote_compose_dir}",
            f"rm -f {remote_zip_path}",
            f"cd {remote_compose_dir} && docker compose up -d"
        ]
        docker_compose_result = None
        for cmd in commands:
            print(f"[INFO] Executing remote command: {cmd}")
            stdin, stdout, stderr = ssh.exec_command(cmd)
            exit_status = stdout.channel.recv_exit_status()
            stdout_str = stdout.read().decode()
            stderr_str = stderr.read().decode()
            print(f"[INFO] Command exit status: {exit_status}")
            if "docker compose up -d" in cmd:
                docker_compose_result = {
                    "command": cmd,
                    "exit_status": exit_status,
                    "stdout": stdout_str.strip().splitlines(),
                    "stderr": stderr_str.strip().splitlines()
                }
            if exit_status != 0:
                print(f"[ERROR] Command error output: {stderr_str}")

        ssh.close()
        print("[INFO] SSH connection closed.")

        return docker_compose_result
    except Exception as e:
        print(f"[ERROR] An error: {e}")
        return {"error": str(e)}
    finally:
        if temp_dir:
            clean_up_temp_dir(temp_dir)

def create_zip_locally(request, hostname):
    temp_dir = tempfile.mkdtemp()
    env_file_path = os.path.join(temp_dir, ".env")
    compose_file_path = os.path.join(temp_dir, "compose.yaml")
    workflow_info_file_path = os.path.join(temp_dir, "workflow-info.json")
    zip_path = os.path.join(temp_dir, "docker-compose.zip")

    workflow_info_raw = WorkflowInfo(request)
    workflow_info = json.loads(workflow_info_raw.export_to_json())
    services_info = process_opea_services(workflow_info)
    ports_info = services_info["services"]["app"]["ports_info"]
    additional_files_info = services_info.get("additional_files", [])

    try:
        with open(env_file_path, 'w') as f:
            f.write(f"public_host_ip='{hostname}'\n")
            for key, value in ports_info.items():
                f.write(f"{key}={value}\n")

        compose_content = convert_proj_info_to_compose(workflow_info)
        with open(compose_file_path, 'w') as f:
            f.write(compose_content)

        with open(workflow_info_file_path, 'w') as f:
            f.write(json.dumps(workflow_info, indent=4))

        with zipfile.ZipFile(zip_path, 'w') as zipf:
            zipf.write(env_file_path, arcname=".env")
            zipf.write(compose_file_path, arcname="compose.yaml")
            zipf.write(workflow_info_file_path, arcname="workflow-info.json")

            for file_info in additional_files_info:
                source_path = file_info["source"]
                target_path = file_info["target"]
                if os.path.isdir(source_path):
                    for root, _, files in os.walk(source_path):
                        for file in files:
                            full_file_path = os.path.join(root, file)
                            relative_path = os.path.relpath(full_file_path, source_path)
                            arcname = os.path.join(target_path, relative_path)
                            zipf.write(full_file_path, arcname=arcname)
                else:
                    zipf.write(source_path, arcname=target_path)

        return zip_path, temp_dir

    except Exception as e:
        print(f"An error occurred while creating the ZIP: {e}")
        clean_up_temp_dir(temp_dir)
        raise RuntimeError(f"Failed to generate ZIP: {e}")

def clean_up_temp_dir(dir_path: str):
    try:
        shutil.rmtree(dir_path)
    except Exception as e:
        logging.exception(f"An error occurred while deleting the temp directory {dir_path}.")