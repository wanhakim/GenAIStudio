from fastapi import APIRouter, HTTPException
from kubernetes import client
import re

router = APIRouter()

def find_pod_dependencies(pod, all_pods, services, namespace, core_v1_api):
    """
    Analyze pod dependencies by checking:
    1. Environment variables pointing to other services
    2. Service selectors matching pod labels
    3. ConfigMaps and Secrets that might reference other pods
    4. Init containers waiting for remote services
    """
    dependencies = []
    
    # Get pod environment variables from main containers
    env_vars = []
    configmap_refs = []
    
    if pod.spec.containers:
        for container in pod.spec.containers:
            # Direct environment variables
            if container.env:
                for env in container.env:
                    if env.value:
                        env_vars.append(env.value)
            
            # Environment variables from ConfigMaps
            if container.env_from:
                for env_from in container.env_from:
                    if env_from.config_map_ref:
                        configmap_refs.append(env_from.config_map_ref.name)
    
    # Get environment variables from init containers (for wait-for-remote-service patterns)
    init_env_vars = []
    
    if pod.spec.init_containers:
        for init_container in pod.spec.init_containers:
            # Direct environment variables from init containers
            if init_container.env:
                for env in init_container.env:
                    if env.value:
                        init_env_vars.append(env.value)
            
            # Environment variables from ConfigMaps in init containers
            if init_container.env_from:
                for env_from in init_container.env_from:
                    if env_from.config_map_ref and env_from.config_map_ref.name not in configmap_refs:
                        configmap_refs.append(env_from.config_map_ref.name)
            
            # Check init container commands for wait-for-remote-service patterns
            if init_container.name == "wait-for-remote-service" or "wait-for" in init_container.name.lower():
                if init_container.command:
                    command_str = " ".join(init_container.command)
                    # Look for service endpoints in commands like "nc -z -v -w30 $HEALTHCHECK_ENDPOINT"
                    # Extract service names from HEALTHCHECK_ENDPOINT or similar patterns
                    for env_var in init_env_vars:
                        # Pattern like "tei-0:9003" or "redis-vector-store-0:9001"
                        service_match = re.search(r'([a-zA-Z0-9-]+):\d+', env_var)
                        if service_match:
                            service_name = service_match.group(1)
                            # Find pods that this service targets
                            for service in services.items:
                                if service.metadata.name == service_name and service.spec.selector:
                                    for target_pod in all_pods.items:
                                        if target_pod.metadata.name != pod.metadata.name:
                                            target_labels = target_pod.metadata.labels or {}
                                            if all(target_labels.get(k) == v for k, v in service.spec.selector.items()):
                                                if target_pod.metadata.name not in dependencies:
                                                    dependencies.append(target_pod.metadata.name)
    
    # Fetch ConfigMap data to analyze environment variables
    configmap_env_vars = []
    for configmap_name in configmap_refs:
        try:
            configmap = core_v1_api.read_namespaced_config_map(name=configmap_name, namespace=namespace)
            if configmap.data:
                for key, value in configmap.data.items():
                    if value:
                        configmap_env_vars.append(value)
        except Exception as e:
            pass
    
    # Combine all environment variables for further analysis
    all_env_vars = env_vars + init_env_vars + configmap_env_vars
    
    # Special handling for app-backend pods - filter out dependent services
    is_app_backend = pod.metadata.name and 'app-backend' in pod.metadata.name
    if is_app_backend:
        # For app-backend, we want to exclude references from dependent_services
        # but keep direct OPEA service references
        filtered_env_vars = []
        for env_val in all_env_vars:
            # Skip if this looks like workflow-info.json content with dependent_services
            if isinstance(env_val, str) and '"dependent_services"' in env_val:
                # Parse the JSON to extract only direct service references, not dependent ones
                try:
                    import json
                    workflow_data = json.loads(env_val)
                    if 'nodes' in workflow_data:
                        # Only include OPEA service names, not their dependencies
                        opea_services = []
                        for node_id, node_data in workflow_data['nodes'].items():
                            if node_data.get('name', '').startswith('opea_service@'):
                                opea_services.append(node_data['name'])
                        # Add these as simple strings for pattern matching
                        filtered_env_vars.extend(opea_services)
                except:
                    # If JSON parsing fails, skip this env var
                    pass
            else:
                filtered_env_vars.append(env_val)
        all_env_vars = filtered_env_vars
    
    # # Debug output
    # print(f"Analyzing dependencies for pod: {pod.metadata.name}")
    # print(f"ConfigMap refs: {configmap_refs}")
    # print(f"Total env vars found: {len(all_env_vars)}")
    # if all_env_vars:
    #     print(f"Sample env vars: {all_env_vars[:3]}")  # Show first 3 for debugging
    
    # Check if environment variables reference other services
    for service in services.items:
        service_name = service.metadata.name
        # Check if service name is referenced in environment variables
        for env_val in all_env_vars:
            if service_name in env_val:
                # Find pods that this service targets
                if service.spec.selector:
                    for target_pod in all_pods.items:
                        if target_pod.metadata.name != pod.metadata.name:
                            target_labels = target_pod.metadata.labels or {}
                            if all(target_labels.get(k) == v for k, v in service.spec.selector.items()):
                                if target_pod.metadata.name not in dependencies:
                                    dependencies.append(target_pod.metadata.name)
    
    # Check for service endpoint patterns in environment variables
    # Pattern like "http://service-name:port" or "service-name:port"
    for env_val in all_env_vars:
        # HTTP URL pattern
        http_matches = re.findall(r'https?://([a-zA-Z0-9-]+):\d+', env_val)
        for service_name in http_matches:
            for service in services.items:
                if service.metadata.name == service_name and service.spec.selector:
                    for target_pod in all_pods.items:
                        if target_pod.metadata.name != pod.metadata.name:
                            target_labels = target_pod.metadata.labels or {}
                            if all(target_labels.get(k) == v for k, v in service.spec.selector.items()):
                                if target_pod.metadata.name not in dependencies:
                                    dependencies.append(target_pod.metadata.name)
        
        # Direct service:port pattern
        service_port_matches = re.findall(r'([a-zA-Z0-9-]+):\d+', env_val)
        for service_name in service_port_matches:
            for service in services.items:
                if service.metadata.name == service_name and service.spec.selector:
                    for target_pod in all_pods.items:
                        if target_pod.metadata.name != pod.metadata.name:
                            target_labels = target_pod.metadata.labels or {}
                            if all(target_labels.get(k) == v for k, v in service.spec.selector.items()):
                                if target_pod.metadata.name not in dependencies:
                                    dependencies.append(target_pod.metadata.name)
    
    # Check DNS-based dependencies (common pattern: service-name.namespace.svc.cluster.local)
    dns_pattern = r'([a-zA-Z0-9-]+)\.(' + re.escape(namespace) + r')\.svc\.cluster\.local'
    for env_val in all_env_vars:
        matches = re.findall(dns_pattern, env_val)
        for match in matches:
            service_name = match[0]
            # Find the service and its target pods
            for service in services.items:
                if service.metadata.name == service_name and service.spec.selector:
                    for target_pod in all_pods.items:
                        if target_pod.metadata.name != pod.metadata.name:
                            target_labels = target_pod.metadata.labels or {}
                            if all(target_labels.get(k) == v for k, v in service.spec.selector.items()):
                                if target_pod.metadata.name not in dependencies:
                                    dependencies.append(target_pod.metadata.name)
    
    # Additional pattern matching for service names that might not include ports
    # Look for patterns where service names appear in environment variable values
    service_names = [service.metadata.name for service in services.items]
    for env_val in all_env_vars:
        for service_name in service_names:
            # More flexible matching - look for service name as whole word
            if re.search(r'\b' + re.escape(service_name) + r'\b', env_val):
                for service in services.items:
                    if service.metadata.name == service_name and service.spec.selector:
                        for target_pod in all_pods.items:
                            if target_pod.metadata.name != pod.metadata.name:
                                target_labels = target_pod.metadata.labels or {}
                                if all(target_labels.get(k) == v for k, v in service.spec.selector.items()):
                                    if target_pod.metadata.name not in dependencies:
                                        dependencies.append(target_pod.metadata.name)
    
    return dependencies

@router.get("/podlogs/{namespace}", summary="Fetch all pods in a namespace")
async def get_all_pods_in_namespace(namespace: str):
    core_v1_api = client.CoreV1Api()
    
    # Fetch pods with include_uninitialized to catch terminating pods
    try:
        pods = core_v1_api.list_namespaced_pod(namespace=namespace, include_uninitialized=True)
    except Exception:
        # Fallback to standard call if include_uninitialized is not supported
        pods = core_v1_api.list_namespaced_pod(namespace=namespace)

    if not pods.items:
        return {"namespace": namespace, "pods": []}

    # Fetch all services in the namespace for dependency analysis
    try:
        services = core_v1_api.list_namespaced_service(namespace=namespace)
    except Exception as e:
        services = None

    pod_list = []
    for pod in pods.items:
        pod_name = pod.metadata.name

        # Initialize log_entries and event_entries
        log_entries = []
        event_entries = []

        # Fetch logs related to the pod
        try:
            pod_logs = core_v1_api.read_namespaced_pod_log(name=pod_name, namespace=namespace, tail_lines=200)
            if pod_logs and pod_logs.strip():
                for line in pod_logs.splitlines():
                    log_entries.append(line)
            else:
                log_entries.append("** Pod has no logs available")
        except Exception as e:
            pass

        # Fetch events related to the pod
        try:
            pod_events = core_v1_api.list_namespaced_event(namespace=namespace)
            event_entries = [
                f"[{event.type}] {event.reason}: {event.message} (at {event.last_timestamp})"
                for event in pod_events.items
                if event.involved_object.name == pod_name
            ]
        except Exception as e:
            pass

        # Analyze pod dependencies
        dependencies = []
        if services:
            try:
                dependencies = find_pod_dependencies(pod, pods, services, namespace, core_v1_api)
                # print(f"Pod {pod_name} dependencies: {dependencies}")
            except Exception as e:
                print(f"Error analyzing dependencies for pod {pod_name}: {str(e)}")
                import traceback
                traceback.print_exc()

        # Determine the Ready and Status of the pod
        ready_status = "Unknown"
        pod_status = pod.status.phase if pod.status.phase else "Unknown"
        
        # Check for terminating state first
        is_terminating = False
        if pod.metadata.deletion_timestamp:
            is_terminating = True
            pod_status = "Terminating"
        elif pod.status.phase in ["Failed", "Succeeded"]:
            pod_status = pod.status.phase
        
        # Calculate ready status
        if pod.status.init_container_statuses:
            ready_count = sum(1 for status in pod.status.init_container_statuses if status.ready)
            total_count = len(pod.status.init_container_statuses)
            ready_status = f"{ready_count}/{total_count}"
        elif pod.status.container_statuses:
            ready_count = sum(1 for status in pod.status.container_statuses if status.ready)
            total_count = len(pod.status.container_statuses)
            ready_status = f"{ready_count}/{total_count}"
        
        # Determine detailed pod status based on current container states
        has_current_error = False
        is_running = False
        is_pending = False
        
        if not is_terminating and pod.status.phase not in ["Failed", "Succeeded"]:
            # Check init container statuses for current errors (not historical)
            if pod.status.init_container_statuses:
                for status in pod.status.init_container_statuses:
                    if status.state and status.state.waiting and status.state.waiting.reason in ['ImagePullBackOff', 'ErrImagePull', 'CrashLoopBackOff', 'Error']:
                        has_current_error = True
                        break
                    elif status.state and status.state.terminated and status.state.terminated.reason == 'Error':
                        has_current_error = True
                        break
            
            # Check main container statuses for current state - prioritize running state
            if pod.status.container_statuses and not has_current_error:
                containers_running = 0
                containers_with_current_errors = 0
                containers_with_high_restarts = 0
                total_containers = len(pod.status.container_statuses)
                
                for status in pod.status.container_statuses:
                    # Priority 1: Check if container is currently running (this overrides restart history)
                    if status.state and status.state.running:
                        containers_running += 1
                        # Even if running, check if it has excessive restarts (indicates instability)
                        if status.restart_count and status.restart_count > 1:
                            containers_with_high_restarts += 1
                    # Priority 2: Check for current error states only if not running
                    elif status.state and status.state.waiting:
                        if status.state.waiting.reason in ['ImagePullBackOff', 'ErrImagePull', 'CrashLoopBackOff']:
                            # These are current errors only if container is not running
                            containers_with_current_errors += 1
                        elif status.state.waiting.reason in ['ContainerCreating', 'PodInitializing']:
                            is_pending = True
                        # Other waiting reasons are treated as pending, not errors
                    elif status.state and status.state.terminated and status.state.terminated.reason == 'Error':
                        # Only count as error if container is currently terminated with error
                        containers_with_current_errors += 1
                
                # Determine overall status based on current state (ignore restart history if currently running)
                if containers_running == total_containers:
                    # All containers running - but check if any have high restart counts
                    if containers_with_high_restarts > 0:
                        # Containers are running but unstable (high restarts)
                        has_current_error = True  # This will show as "Error" status
                    else:
                        is_running = True
                elif containers_with_current_errors > 0:
                    has_current_error = True
                elif containers_running > 0:
                    # Some containers running, some pending - consider it as pending/starting
                    is_pending = True
        
        # Set pod status based on current conditions (prioritize current state over history)
        if pod.metadata.deletion_timestamp:
            pod_status = "Terminating"
        elif has_current_error:
            pod_status = "Error"
        elif is_running:
            pod_status = "Running"
        elif is_pending:
            pod_status = "Pending"
        elif pod.status.init_container_statuses:
            ready_count = sum(1 for status in pod.status.init_container_statuses if status.ready)
            total_count = len(pod.status.init_container_statuses)
            if ready_count < total_count:
                pod_status = f"Init:{ready_count}/{total_count}"

        pod_list.append({
            "name": pod.metadata.name,
            "namespace": pod.metadata.namespace,
            "ready": ready_status,
            "status": pod_status,
            "labels": pod.metadata.labels,
            "annotations": pod.metadata.annotations,
            "logs": log_entries,
            "events": event_entries,
            "dependencies": dependencies,
        })

    return {"namespace": namespace, "pods": pod_list}