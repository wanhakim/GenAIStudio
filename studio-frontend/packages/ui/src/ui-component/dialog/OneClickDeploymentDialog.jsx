import { createPortal } from 'react-dom';
import { useDispatch } from 'react-redux';
import { useEffect, useState, useRef } from 'react';
import PropTypes from 'prop-types';
import {
    Box,
    Button,
    Dialog,
    DialogActions,
    DialogContent,
    DialogTitle,
    OutlinedInput,
    Typography,
    IconButton,
    Tooltip,
    CircularProgress
} from '@mui/material';

import { StyledButton } from '@/ui-component/button/StyledButton';
import { IconCopy, IconCheck } from '@tabler/icons-react';
import {
    closeSnackbar as closeSnackbarAction,
    enqueueSnackbar as enqueueSnackbarAction,
    HIDE_CANVAS_DIALOG,
    SHOW_CANVAS_DIALOG
} from '@/store/actions';
import chatflowsApi from '@/api/chatflows';

const OneClickDeploymentDialog = ({ show, dialogProps, onCancel, onConfirm, deployStatus, setDeployStatus, deploymentConfig, setDeploymentConfig, deployWebSocket, setDeployWebSocket, openDeploymentWebSocket }) => {
    const portalElement = document.getElementById('portal');
    const dispatch = useDispatch();
    const [pubkey, setPubkey] = useState('');
    const [copied, setCopied] = useState(false);
    const [deploying, setDeploying] = useState(false);
    const [stopping, setStopping] = useState(false);
    const [deploymentCompleted, setDeploymentCompleted] = useState(false);
    // Remove local ws state - use the persistent one from parent
    const wsRef = useRef(deployWebSocket);
    const deploymentCompletedRef = useRef(deploymentCompleted);

    // Function to update deployment status in database
    const updateClickDeployStatus = async (chatflowId, status) => {
        try {
            const updateObj = { clickDeployStatus: status };
            await chatflowsApi.updateChatflow(chatflowId, updateObj);
            console.log(`Updated one-click deployment status to: ${status}`);
        } catch (error) {
            console.error('Failed to update one-click deployment status:', error);
        }
    };

    // Sync the ref when the parent WebSocket changes
    useEffect(() => {
        wsRef.current = deployWebSocket;
        deploymentCompletedRef.current = deploymentCompleted;
        if (deployWebSocket && deployWebSocket.readyState === WebSocket.OPEN) {
            setDeploying(true);
            // Set up event handlers for the existing WebSocket
            deployWebSocket.onmessage = (event) => {
                let data;
                try { data = JSON.parse(event.data); } catch { return; }
                console.log('WebSocket message:', data);
                if (data.status === 'Done') {
                    console.log('Deployment completed successfully:', data.success);
                    setDeployStatus(['Success', ...(data.success || '').split(',').map(line => line.trim())]);
                    setDeploying(false);
                    setDeploymentCompleted(true);
                    deploymentCompletedRef.current = true;
                    // Update database status to 'Deployed'
                    updateClickDeployStatus(dialogProps.id, 'Deployed');
                    // Clean up WebSocket on completion
                    if (wsRef.current) {
                        wsRef.current.close();
                        wsRef.current = null;
                        setDeployWebSocket(null);
                    }
                } else if (data.status === 'Error') {
                    console.log('Deployment failed with error:', data.error);
                    let lines = [];
                    if (Array.isArray(data.error)) {
                        lines = data.error;
                    } else if (typeof data.error === 'string') {
                        lines = data.error.split(',').map(line => line.trim());
                    } else {
                        lines = ['Unknown error'];
                    }
                    setDeployStatus(['Error', ...lines]);
                    setDeploying(false);
                    setDeploymentCompleted(true);
                    deploymentCompletedRef.current = true;
                    // Update database status to 'Error'
                    updateClickDeployStatus(dialogProps.id, 'Error');
                    // Clean up WebSocket on error
                    if (wsRef.current) {
                        wsRef.current.close();
                        wsRef.current = null;
                        setDeployWebSocket(null);
                    }
                } else if (data.status === 'In Progress') {
                    console.log('Deployment in progress:', data.nohup_out);
                    
                    // Check if the nohup output indicates deployment completion
                    const output = data.nohup_out || '';
                    
                    // Look for Docker Compose completion patterns
                    const hasDockerComposeCommand = output.includes('docker compose up -d');
                    const hasSuccessIndicators = 
                        output.includes('✔ Network') || output.includes('✔ Container') || 
                        output.includes('Created') || output.includes('Started') ||
                        output.includes('Running') || output.match(/\[.*\]\s*(Started|Created|Running)/) ||
                        output.match(/Container .+ (Started|Created|Running)/i);
                    
                    // Check for explicit completion messages
                    const hasCompletionMessage = 
                        output.includes('Deployment completed') ||
                        output.includes('Services are up and running') ||
                        output.includes('All services started successfully') ||
                        output.match(/Successfully deployed|Deployment successful|All containers are running/i);
                    
                    // Deployment is complete if we have docker compose command with success indicators OR explicit completion message
                    const isDeploymentComplete = (hasDockerComposeCommand && hasSuccessIndicators) || hasCompletionMessage;
                    
                    if (isDeploymentComplete) {
                        console.log('Deployment appears to be completed based on nohup output');
                        setDeployStatus(['Success', 'Deployment completed successfully', output]);
                        setDeploying(false);
                        setDeploymentCompleted(true);
                        deploymentCompletedRef.current = true;
                        // Update database status to 'Deployed'
                        updateClickDeployStatus(dialogProps.id, 'Deployed');
                        // Clean up WebSocket on completion
                        if (wsRef.current) {
                            wsRef.current.close();
                            wsRef.current = null;
                            setDeployWebSocket(null);
                        }
                    } else {
                        setDeployStatus(['Info', data.nohup_out]);
                    }
                } else if (data.status === 'Preparing') {
                    console.log('Deployment preparing:', data.message);
                    setDeployStatus(['Info', data.message]);
                }
            };
            deployWebSocket.onerror = (error) => {
                console.error('WebSocket error:', error);
                setDeployStatus(['Error', 'WebSocket connection error']);
                setDeploying(false);
                // Update database status to 'Error' on WebSocket error
                updateClickDeployStatus(dialogProps.id, 'Error');
            };
            deployWebSocket.onclose = (event) => {
                console.log('WebSocket closed:', event.code, event.reason);
                wsRef.current = null;
                setDeployWebSocket(null);
                // Only show error if deployment was not completed successfully
                // Use setTimeout to ensure state updates have been processed
                setTimeout(() => {
                    if (!deploymentCompletedRef.current) {
                        console.log('WebSocket closed but deployment not marked as completed - showing connection lost error');
                        setDeployStatus(['Error', 'Connection lost during deployment']);
                        setDeploying(false);
                        // Update database status to 'Error' on unexpected close
                        updateClickDeployStatus(dialogProps.id, 'Error');
                    } else {
                        console.log('WebSocket closed but deployment was already completed - no error shown');
                    }
                }, 100);
            };
        }
    }, [deployWebSocket, setDeployWebSocket, setDeployStatus, dialogProps.id]);

    useEffect(() => {
        if (show) {
            dispatch({ type: SHOW_CANVAS_DIALOG });
            
            // Load public key
            chatflowsApi.getPublicKey().then(response => {
                if (response.error) {
                    dispatch(enqueueSnackbarAction({
                        message: 'Error loading public key',
                        options: { variant: 'error' }
                    }));
                } else {
                    setPubkey(response.data.pubkey || '');
                }
            });

            // Check current deployment status from database and set appropriate state
            chatflowsApi.getSpecificChatflow(dialogProps.id).then(response => {
                if (response.data && response.data.clickDeployStatus) {
                    const currentStatus = response.data.clickDeployStatus;
                    
                    if (currentStatus === 'Deployed') {
                        // Show success state
                        setDeployStatus(['Success', 'Deployment completed successfully']);
                        setDeploymentCompleted(true);
                        deploymentCompletedRef.current = true;
                        setDeploying(false);
                    } else if (currentStatus === 'Error') {
                        // Show error state
                        setDeployStatus(['Error', 'Previous deployment failed']);
                        setDeploymentCompleted(true);
                        deploymentCompletedRef.current = true;
                        setDeploying(false);
                    } else if (currentStatus === 'Stopped') {
                        // Show stopped state
                        setDeployStatus(['Info', 'Deployment was stopped']);
                        setDeploymentCompleted(true);
                        deploymentCompletedRef.current = true;
                        setDeploying(false);
                    } else if (currentStatus === 'Deploying') {
                        // Check if there's a WebSocket still running
                        if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
                            setDeploying(true); // Resume showing deploying state
                            setDeploymentCompleted(false);
                            deploymentCompletedRef.current = false;
                            // If no status yet, show reconnection message
                            if (!deployStatus || deployStatus.length === 0) {
                                setDeployStatus(['Info', 'Reconnecting to deployment in progress...']);
                            }
                            // WebSocket event handlers are already set up in the other useEffect
                        } else {
                            // No active WebSocket but status is deploying - likely stale state
                            setDeployStatus(['Error', 'Connection lost. Please try deployment again.']);
                            setDeploymentCompleted(true);
                            deploymentCompletedRef.current = true;
                            setDeploying(false);
                            // Update database to reflect error state
                            updateClickDeployStatus(dialogProps.id, 'Error');
                        }
                    } else {
                        // Default state for new deployments
                        setDeploymentCompleted(false);
                        deploymentCompletedRef.current = false;
                        setDeploying(false);
                    }
                }
            }).catch(error => {
                console.error('Failed to load chatflow status:', error);
            });
        } else {
            dispatch({ type: HIDE_CANVAS_DIALOG });
            // Don't clean up WebSocket when modal is just hidden
            // Let deployment continue in background
        }
        return () => {
            dispatch({ type: HIDE_CANVAS_DIALOG });
            // Only clean up on component unmount (when parent component unmounts)
            // Parent component will handle WebSocket cleanup
        };
    }, [show, dispatch, dialogProps.id]);

    const handleCancel = () => {
        // Don't clean up WebSocket - let it continue monitoring in background
        // Just close the modal while keeping the deployment running
        setDeploying(false); // Reset local deploying state for UI
        onCancel(); // Call the parent's onCancel to close modal
    };

    const handleCopy = () => {
        navigator.clipboard.writeText(pubkey);
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
    };

    const handleStopDeployment = async () => {
        try {
            setStopping(true);
            setDeployStatus(['Info', 'Stopping deployment...']);
            
            // Call the stop deployment API
            const response = await chatflowsApi.stopOneClickDeployment(dialogProps.id, {
                hostname: deploymentConfig.hostname,
                username: deploymentConfig.username
            });
            
            if (response.data && response.data.success) {
                setDeployStatus(['Info', 'Deployment stopped successfully']);
                setDeploying(false);
                setDeploymentCompleted(true);
                deploymentCompletedRef.current = true;
                
                // Update database status to 'Stopped'
                await updateClickDeployStatus(dialogProps.id, 'Stopped');
                
                // Close WebSocket connection
                if (wsRef.current) {
                    wsRef.current.close();
                    wsRef.current = null;
                    setDeployWebSocket(null);
                }
            } else {
                setDeployStatus(['Error', response.data?.error || 'Failed to stop deployment']);
                setDeploying(false); // Reset deploying state on failure
                setDeploymentCompleted(true);
                deploymentCompletedRef.current = true;
                // Update database status to 'Error' on failure
                await updateClickDeployStatus(dialogProps.id, 'Error');
            }
        } catch (error) {
            console.error('Error stopping deployment:', error);
            
            // Check if it's a 500 error (server error)
            if (error.response && error.response.status === 500) {
                setDeployStatus(['Error', 'Server error occurred while stopping deployment. The deployment may still be running on the remote machine.']);
            } else if (error.response && error.response.data) {
                // Try to extract error message from response
                const errorMessage = typeof error.response.data === 'object' 
                    ? (error.response.data.message || error.response.data.detail || JSON.stringify(error.response.data))
                    : error.response.data;
                setDeployStatus(['Error', 'Failed to stop deployment: ' + errorMessage]);
            } else {
                setDeployStatus(['Error', 'Failed to stop deployment: ' + (error.message || 'Unknown error')]);
            }
            
            setDeploying(false); // Reset deploying state on error
            setDeploymentCompleted(true);
            deploymentCompletedRef.current = true;
            // Update database status to 'Error' on exception
            await updateClickDeployStatus(dialogProps.id, 'Error');
        } finally {
            setStopping(false);
        }
    };

    const handleOneClickDeploy = async () => {
        // Check if there's already an active WebSocket for this deployment
        if (deployWebSocket && deployWebSocket.readyState === WebSocket.OPEN) {
            // Deployment is already in progress, just show the UI
            setDeploying(true);
            return;
        }
        
        setDeploying(true);
        setDeploymentCompleted(false); // Reset completion flag
        deploymentCompletedRef.current = false; // Reset ref too
        setDeployStatus(['Info', 'Connecting to machine...']);
        
        // Update database status to 'Deploying'
        await updateClickDeployStatus(dialogProps.id, 'Deploying');
        
        try {
            const result = await onConfirm(dialogProps.id, deploymentConfig);
            if (result && result.error) {
                setDeployStatus(['Error', result.error]);
                setDeploying(false);
                // Update database status to 'Error' on initial failure
                await updateClickDeployStatus(dialogProps.id, 'Error');
                return;
            }
            const compose_dir = result?.compose_dir;
            const wsUrl = `${window.location.origin.replace(/^http/, 'ws')}/studio-backend/ws/deploy-and-monitor`;
            const wsInstance = new window.WebSocket(wsUrl);
            
            // Update parent with the WebSocket reference for persistence
            wsRef.current = wsInstance;
            setDeployWebSocket(wsInstance);

            wsInstance.onopen = () => {
                wsInstance.send(JSON.stringify({ hostname: deploymentConfig.hostname, username: deploymentConfig.username, compose_dir: compose_dir }));
            };
            wsInstance.onmessage = (event) => {
                let data;
                try { data = JSON.parse(event.data); } catch { return; }
                console.log('WebSocket message:', data);
                if (data.status === 'Done') {
                    console.log('Deployment completed successfully:', data.success);
                    setDeployStatus(['Success', ...(data.success || '').split(',').map(line => line.trim())]);
                    setDeploying(false);
                    setDeploymentCompleted(true);
                    deploymentCompletedRef.current = true;
                    // Update database status to 'Deployed'
                    updateClickDeployStatus(dialogProps.id, 'Deployed');
                    // Clean up WebSocket on completion
                    if (wsRef.current) {
                        wsRef.current.close();
                        wsRef.current = null;
                        setDeployWebSocket(null);
                    }
                } else if (data.status === 'Error') {
                    console.log('Deployment failed with error:', data.error);
                    let lines = [];
                    if (Array.isArray(data.error)) {
                        lines = data.error;
                    } else if (typeof data.error === 'string') {
                        lines = data.error.split(',').map(line => line.trim());
                    } else {
                        lines = ['Unknown error'];
                    }
                    setDeployStatus(['Error', ...lines]);
                    setDeploying(false);
                    setDeploymentCompleted(true);
                    deploymentCompletedRef.current = true;
                    // Update database status to 'Error'
                    updateClickDeployStatus(dialogProps.id, 'Error');
                    // Clean up WebSocket on error
                    if (wsRef.current) {
                        wsRef.current.close();
                        wsRef.current = null;
                        setDeployWebSocket(null);
                    }
                } else if (data.status === 'In Progress') {
                    console.log('Deployment in progress:', data.nohup_out);
                    
                    // Check if the nohup output indicates deployment completion
                    const output = data.nohup_out || '';
                    
                    // Look for Docker Compose completion patterns
                    const hasDockerComposeCommand = output.includes('docker compose up -d');
                    const hasSuccessIndicators = 
                        output.includes('✔ Network') || output.includes('✔ Container') || 
                        output.includes('Created') || output.includes('Started') ||
                        output.includes('Running') || output.match(/\[.*\]\s*(Started|Created|Running)/) ||
                        output.match(/Container .+ (Started|Created|Running)/i);
                    
                    // Check for explicit completion messages
                    const hasCompletionMessage = 
                        output.includes('Deployment completed') ||
                        output.includes('Services are up and running') ||
                        output.includes('All services started successfully') ||
                        output.match(/Successfully deployed|Deployment successful|All containers are running/i);
                    
                    // Deployment is complete if we have docker compose command with success indicators OR explicit completion message
                    const isDeploymentComplete = (hasDockerComposeCommand && hasSuccessIndicators) || hasCompletionMessage;
                    
                    if (isDeploymentComplete) {
                        console.log('Deployment appears to be completed based on nohup output');
                        setDeployStatus(['Success', 'Deployment completed successfully', output]);
                        setDeploying(false);
                        setDeploymentCompleted(true);
                        deploymentCompletedRef.current = true;
                        // Update database status to 'Deployed'
                        updateClickDeployStatus(dialogProps.id, 'Deployed');
                        // Clean up WebSocket on completion
                        if (wsRef.current) {
                            wsRef.current.close();
                            wsRef.current = null;
                            setDeployWebSocket(null);
                        }
                    } else {
                        setDeployStatus(['Info', data.nohup_out]);
                    }
                } else if (data.status === 'Preparing') {
                    console.log('Deployment preparing:', data.message);
                    setDeployStatus(['Info', data.message]);
                }
            };
            wsInstance.onerror = (error) => {
                console.error('WebSocket error:', error);
                setDeployStatus(['Error', 'WebSocket connection error']);
                setDeploying(false);
                // Update database status to 'Error' on WebSocket error
                updateClickDeployStatus(dialogProps.id, 'Error');
            };
            wsInstance.onclose = (event) => {
                console.log('WebSocket closed:', event.code, event.reason);
                wsRef.current = null;
                setDeployWebSocket(null);
                // Only show error if deployment was not completed successfully
                // Use setTimeout to ensure state updates have been processed
                setTimeout(() => {
                    if (!deploymentCompletedRef.current) {
                        console.log('WebSocket closed but deployment not marked as completed - showing connection lost error');
                        setDeployStatus(['Error', 'Connection lost during deployment']);
                        setDeploying(false);
                        // Update database status to 'Error' on unexpected close
                        updateClickDeployStatus(dialogProps.id, 'Error');
                    } else {
                        console.log('WebSocket closed but deployment was already completed - no error shown');
                    }
                }, 100);
            };
        } catch (err) {
            setDeployStatus(['Error', 'Deployment failed']);
            setDeploying(false);
            // Update database status to 'Error' on exception
            await updateClickDeployStatus(dialogProps.id, 'Error');
        }
    };

    const renderStatus = () => {
        if (!deployStatus) return null;
        const [statusType, ...lines] = deployStatus;
        let color = statusType === 'Error' ? 'red' : statusType === 'Success' ? 'green' : 'primary.main';
        let displayLines = lines;
        let effectiveStatusType = statusType;
        
        // Only check for error keywords in Info status, not in Success status
        if (statusType === 'Info') {
            let flatLines = Array.isArray(lines[0]) ? lines[0] : lines;
            // Check for error/fail in any line only if not successfully completed
            if (!deploymentCompleted && flatLines.some(line => typeof line === 'string' && (/error|fail/i).test(line))) {
                color = 'red';
                effectiveStatusType = 'Error';
            }
            displayLines = flatLines;
        }
        
        return (
            <Box sx={{ pt: 2, pb: 2, display: 'flex', alignItems: 'flex-start', gap: 1 }}>
                <Box sx={{ display: 'flex', flexDirection: 'column', width: '100%' }}>
                    <Box sx={{ fontWeight: 600, fontSize: '1rem', color, mb: 1 }}>{effectiveStatusType}</Box>
                    <Box
                        sx={{
                            display: 'flex',
                            flexDirection: 'row',
                            alignItems: 'flex-start',
                            fontFamily: 'monospace',
                            fontSize: '0.95rem',
                            background: '#f5f5f5',
                            borderRadius: 1,
                            p: 2,
                            whiteSpace: 'pre-wrap',
                            color,
                            width: '100%'
                        }}
                    >
                        {(deploying || stopping) && <CircularProgress size={18} sx={{ mr: 1, mt: 0.5 }} />}
                        <Box sx={{ display: 'flex', flexDirection: 'column', width: '100%' }}>
                            {displayLines.map((line, idx) => <div key={idx}>{line}</div>)}
                        </Box>
                    </Box>
                </Box>
            </Box>
        );
    };

    const component = show ? (
        <Dialog onClose={handleCancel} open={show} fullWidth maxWidth='sm' aria-labelledby='one-click-deployment-title'>
            <DialogTitle sx={{ fontSize: '1rem' }} id='one-click-deployment-title'>
                {dialogProps.title || 'One Click Deployment'}
            </DialogTitle>
            <DialogContent>
                <Box sx={{ pt: 2, pb: 2 }}>
                    <Box sx={{ display: 'flex', alignItems: 'center', mb: 1 }}>
                        <Typography sx={{ mr: 1 }}>Public Key <span style={{ color: 'red' }}>*</span></Typography>
                        <Tooltip title={copied ? 'Copied!' : 'Copy'}>
                            <IconButton size='small' onClick={handleCopy} disabled={!pubkey}>
                                {copied ? <IconCheck size={18} color='green' /> : <IconCopy size={18} />}
                            </IconButton>
                        </Tooltip>
                    </Box>
                    <Box component='pre' sx={{ background: '#f5f5f5', borderRadius: 1, p: 2, fontFamily: 'monospace', fontSize: '0.95rem', overflowX: 'auto', mb: 2 }}>{pubkey}</Box>
                </Box>
                <Box sx={{ pt: 2, pb: 2 }}>
                    <Typography sx={{ mb: 1 }}>Hostname <span style={{ color: 'red' }}>*</span></Typography>
                    <OutlinedInput fullWidth value={deploymentConfig.hostname} onChange={e => setDeploymentConfig({ ...deploymentConfig, hostname: e.target.value })} placeholder='Enter hostname' />
                </Box>
                <Box sx={{ pt: 2, pb: 2 }}>
                    <Typography sx={{ mb: 1 }}>Username <span style={{ color: 'red' }}>*</span></Typography>
                    <OutlinedInput fullWidth value={deploymentConfig.username} onChange={e => setDeploymentConfig({ ...deploymentConfig, username: e.target.value })} placeholder='Enter username' />
                </Box>
                {renderStatus()}
            </DialogContent>
            <DialogActions>
                <Button onClick={handleCancel} disabled={deploying || stopping}>{dialogProps.cancelButtonName || 'Cancel'}</Button>
                <StyledButton 
                    disabled={deploying ? (dialogProps.disabled || stopping) : (!deploymentConfig.hostname || !deploymentConfig.username || dialogProps.disabled || stopping)} 
                    variant='contained' 
                    onClick={deploying ? handleStopDeployment : handleOneClickDeploy}
                    color={deploying ? 'error' : 'primary'}
                >
                    {stopping ? 'Stopping...' : (deploying ? 'Stop Deployment' : (dialogProps.confirmButtonName || 'Deploy'))}
                </StyledButton>
            </DialogActions>
        </Dialog>
    ) : null;

    return createPortal(component, portalElement);
};

OneClickDeploymentDialog.propTypes = {
    show: PropTypes.bool,
    dialogProps: PropTypes.object,
    onCancel: PropTypes.func,
    onConfirm: PropTypes.func,
    deployStatus: PropTypes.array,
    setDeployStatus: PropTypes.func,
    deploymentConfig: PropTypes.object,
    setDeploymentConfig: PropTypes.func,
    deployWebSocket: PropTypes.object,
    setDeployWebSocket: PropTypes.func,
    openDeploymentWebSocket: PropTypes.func
};

export default OneClickDeploymentDialog;
