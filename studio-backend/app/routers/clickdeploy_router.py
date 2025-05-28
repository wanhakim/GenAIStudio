from fastapi import APIRouter, HTTPException, Form


from app.models.pipeline_model import DeployPipelineFlow
from app.services.clickdeploy_service import deploy_pipeline


router = APIRouter()


@router.post("/deploy")
async def deploy(request: DeployPipelineFlow):

    remote_host = request.remoteHost
    remote_user = request.remoteUser
    pipeline_flow = request.pipelineFlow
    
    try:
        response = deploy_pipeline(remote_host, remote_user, pipeline_flow.dict())
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

    return response