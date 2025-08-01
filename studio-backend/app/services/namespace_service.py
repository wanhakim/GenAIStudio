from kubernetes import client
from kubernetes.client.rest import ApiException
import time
import yaml
import traceback

from app.services.exporter_service import convert_proj_info_to_manifest
from app.services.dashboard_service import import_grafana_dashboards, delete_dashboard
from app.utils.namespace_utils import wait_for_deployment, wait_for_service, wait_for_namespace_ready  

def deploy_manifest_in_namespace(core_v1_api, apps_v1_api, proj_info):
    
    # Get namespace_name
    print(proj_info['id'])
    namespace_name = f"sandbox-{proj_info['id']}"
    
    # Convert the mega_yaml to a manifest string
    try:
        manifest_string = convert_proj_info_to_manifest(proj_info)
    except Exception as e:
        traceback.print_exc()
        print(f"Error converting project info to manifest: {e}")

    # Split the manifest string into individual YAML documents
    yaml_docs_deploy = yaml.safe_load_all(manifest_string)
    
    # Check if the namespace exists
    try:
        existing_namespace = core_v1_api.read_namespace(name=namespace_name)
        print(f"Namespace '{namespace_name}' already exists - deleting first")
        
        # Delete the existing namespace first
        try:
            core_v1_api.delete_namespace(name=namespace_name, body=client.V1DeleteOptions())
            print(f"Namespace '{namespace_name}' is being deleted.")
        except ApiException as delete_e:
            print(f"Error deleting existing namespace: {delete_e}")
        
        # Return status indicating deletion is in progress
        return {"status": "Deleting existing namespace", "namespace": namespace_name}
        
    except ApiException as e:        
        if e.status == 404:
            # Namespace not found, create it
            namespace = client.V1Namespace(
                metadata = client.V1ObjectMeta(name=namespace_name)
            )
            core_v1_api.create_namespace(namespace)
            print(f"Namespace '{namespace_name}' created")
        else:
            print(f"exception: {e}")
            raise
    
    # Import the dashboard
    dashboard_response = import_grafana_dashboards(namespace_name)

    # Initialize the deployment status list
    deployment_status = []

    # Iterate over each document and deploy it
    for manifest in yaml_docs_deploy:
        if manifest is None:  # Skip empty documents
            continue
        try:
            name = manifest["metadata"]["name"]
            kind = manifest["kind"]
            if kind == "ConfigMap":
                core_v1_api.create_namespaced_config_map(namespace=namespace_name, body=manifest)
            elif kind == "Service":
                core_v1_api.create_namespaced_service(namespace=namespace_name, body=manifest)
            elif kind == "Deployment":
                apps_v1_api.create_namespaced_deployment(namespace=namespace_name, body=manifest)
            elif kind == "Secret":
                core_v1_api.create_namespaced_secret(namespace=namespace_name, body=manifest)
            elif kind == "PersistentVolumeClaim":
                core_v1_api.create_namespaced_persistent_volume_claim(namespace=namespace_name, body=manifest)
            else:
                deployment_status.append({
                    "kind": kind,
                    "name": manifest['metadata']['name'],
                    "status": "Unsupported kind"
                })
                continue
            deployment_status.append({
                "kind": kind,
                "name": manifest['metadata']['name'],
                "status": "Deployed"
            })
            # for debug
            # print(f"Manifest for '{kind}' named '{manifest['metadata']['name']}' deployed in namespace '{namespace_name}'")
            # print(f"Manifest content: {yaml.dump(manifest, default_flow_style=False)}")
        except ApiException as e:
            print(f"Exception when calling Kubernetes API: {e}")
            deployment_status.append({
                "kind": kind,
                "name": manifest['metadata']['name'],
                "status": f"Failed: {e}"
            })
            raise

    return {"status": "Getting Ready", "deployment_msg": deployment_status, "dashboard_msg": dashboard_response}

def delete_namespace(core_v1_api, proj_id):
    
    # Get namespace_name
    namespace_name = f"sandbox-{proj_id}"

    # Delete the dashboard
    dashboard_response = delete_dashboard(namespace_name)

    # Delete the namespace
    try:
        core_v1_api.delete_namespace(name=namespace_name, body=client.V1DeleteOptions())
        print(f"Namespace '{namespace_name}' is terminating.")
        return {"status": "Stopping", "msg": f"Namespace '{namespace_name}' is terminating.", "dashboard_msg": dashboard_response}  
    except ApiException as e:
        print(f"Exception when deleting namespace: {e}")
        return {"status": "Error", "msg": f"Exception when deleting namespace: {e}"}

def check_ns_status(namespace_id, status_type, core_v1_api, apps_v1_api, proj_info=None):

    namespace_name = f"sandbox-{namespace_id}"

    if status_type == "Deleting existing namespace":
        # Wait for the namespace to be deleted
        start_time = time.time()
        while time.time() - start_time < 300:  # 5 minute timeout
            try:
                core_v1_api.read_namespace(name=namespace_name)
                time.sleep(2)  # Check every 2 seconds
            except ApiException as e:
                if e.status == 404:
                    print(f"Namespace {namespace_name} successfully deleted, ready to redeploy")
                    # Namespace is deleted, indicate ready for redeployment
                    return {"status": "Ready for redeployment"}
        
        # Timeout - namespace still exists
        print(f"Namespace {namespace_name} deletion timed out")
        return {"status": "Error", "msg": "Namespace deletion timed out"}

    elif status_type == "Getting Ready":

        # List all deployments and services for checking
        deployments = apps_v1_api.list_namespaced_deployment(namespace=namespace_name)
        services = core_v1_api.list_namespaced_service(namespace=namespace_name)
        
        # Wait for all pods to be ready (this will fail fast if any pod fails)
        print(f"Checking all pods in namespace: {namespace_name}")
        if not wait_for_namespace_ready(namespace_name, core_v1_api):
            print(f"One or more pods failed to become ready in namespace {namespace_name} - returning Error status")
            return {"status": "Error", "failed_component": "pods"}

        # Wait for all deployments to be ready
        for deployment in deployments.items:
            deployment_name = deployment.metadata.name
            print(f"Checking deployment: {deployment_name}")
            if not wait_for_deployment(namespace_name, deployment_name, apps_v1_api):
                print(f"Deployment {deployment_name} failed to become ready - returning Error status")
                return {"status": "Error", "failed_deployment": deployment_name}

        # Wait for all services to be ready
        for service in services.items:
            service_name = service.metadata.name
            print(f"Checking service: {service_name}")
            if not wait_for_service(namespace_name, service_name, core_v1_api):
                print(f"Service {service_name} failed to become ready - returning Error status")
                return {"status": "Error", "failed_service": service_name}

        sandbox_app_url = f"/?ns={namespace_name}"
        sandbox_grafana_url = f"/grafana/d/{namespace_id}"
        sandbox_tracer_url = f"/tracer/{namespace_name}"
        sandbox_debuglogs_url = f"/debuglogs/{namespace_name}"

        return {f"status": "Ready", "sandbox_app_url": sandbox_app_url, "sandbox_grafana_url": sandbox_grafana_url, "sandbox_tracer_url": sandbox_tracer_url, "sandbox_debuglogs_url": sandbox_debuglogs_url}

    elif status_type == "Stopping":

        # Wait for the namespace to be deleted
        start_time = time.time()
        while time.time() - start_time < 300:
            try:
                core_v1_api.read_namespace(name=namespace_name)
            except ApiException as e:
                if e.status == 404:
                    print(f"Namespace {namespace_name} deleted")
                    return {"status": "Not Running"}
            time.sleep(5)
        print(f"Namespace {namespace_name} was not deleted in time")
        return {"status": "Error"}