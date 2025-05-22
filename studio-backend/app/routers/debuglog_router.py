from fastapi import APIRouter, HTTPException
from kubernetes import client

router = APIRouter()

import json
from fastapi import APIRouter, HTTPException
from kubernetes import client

router = APIRouter()

@router.get("/podlogs/{namespace}", summary="Fetch all pods in a namespace")
async def get_all_pods_in_namespace(namespace: str):
    core_v1_api = client.CoreV1Api()
    pods = core_v1_api.list_namespaced_pod(namespace=namespace)

    if not pods.items:
        raise HTTPException(status_code=404, detail=f"No pods found in namespace '{namespace}'")

    pod_list = []
    for pod in pods.items:
        pod_name = pod.metadata.name
        
        # Fetch logs related to the pod
        try:
            pod_logs = core_v1_api.read_namespaced_pod_log(name=pod_name, namespace=namespace, tail_lines=10)
            log_entries = []
            for line in pod_logs.splitlines():
                log_entries.append(line)
        except Exception as e:
            pod_logs = [{"error": f"Error fetching logs: {str(e)}"}]

        # Fetch events related to the pod
        try:
            pod_events = core_v1_api.list_namespaced_event(namespace=namespace)
            event_entries = [
                f"[{event.type}] {event.reason}: {event.message} (at {event.last_timestamp})"
                for event in pod_events.items
                if event.involved_object.name == pod_name
            ]
            
        except Exception as e:
            pod_events = [{"error": f"Error fetching events: {str(e)}"}]

        pod_list.append({
            "name": pod.metadata.name,
            "namespace": pod.metadata.namespace,
            "status": pod.status.phase,
            "labels": pod.metadata.labels,
            "annotations": pod.metadata.annotations,
            "logs": log_entries,
            "events": event_entries,
        })

    return {"namespace": namespace, "pods": pod_list}

@router.get("/podlogs/{namespace}/{pod_name}", summary="Fetch logs for a specific pod by name")
async def pod_logs_by_namespace_and_pod_name(namespace: str, pod_name: str):
    core_v1_api = client.CoreV1Api()

    try:
        # Fetch the logs for the specified pod
        pod_logs = core_v1_api.read_namespaced_pod_log(name=pod_name, namespace=namespace, tail_lines=50)
        log_entries = []
        for line in pod_logs.splitlines():
            log_entries.append(line)
    except client.exceptions.ApiException as e:
        if e.status == 404:
            raise HTTPException(status_code=404, detail=f"Pod '{pod_name}' not found in namespace '{namespace}'")
        else:
            raise HTTPException(status_code=500, detail=f"Error fetching pod logs: {str(e)}")

    return {"pod_name": pod_name, "namespace": namespace, "log": log_entries}
