import { useState, useEffect, useCallback } from 'react'
import PropTypes from 'prop-types'
import { useSelector } from 'react-redux'
import moment from 'moment'
import { styled } from '@mui/material/styles'
import {
    Box,
    Button,
    Chip,
    CircularProgress,
    Paper,
    Skeleton,
    Stack,
    Table,
    TableBody,
    TableCell,
    TableContainer,
    TableHead,
    TableRow,
    TableSortLabel,
    Tooltip,
    Typography,
    useTheme,
    Menu,
    MenuItem
} from '@mui/material'
import { tableCellClasses } from '@mui/material/TableCell'
import FlowListMenu from '../button/FlowListMenu'
import { Link } from 'react-router-dom'
import {
    OpenInNew,
    StopCircleOutlined,
    Analytics,
    PlayCircleOutline,
    UnarchiveOutlined,
    ViewTimelineOutlined,
    InstallDesktopOutlined,
    TroubleshootOutlined,
    TerminalOutlined
} from '@mui/icons-material'

import BuildDeploymentPackageDialog from '../dialog/BuildDeploymentPackageDialog'
import OneClickDeploymentDialog from '../dialog/OneClickDeploymentDialog'
import chatflowsApi from '@/api/chatflows'
import config from '@/config'

const StyledTableCell = styled(TableCell)(({ theme }) => ({
    borderColor: theme.palette.grey[900] + 25,

    [`&.${tableCellClasses.head}`]: {
        color: theme.palette.grey[900]
    },
    [`&.${tableCellClasses.body}`]: {
        fontSize: 14,
        height: 64
    }
}))

const StyledTableRow = styled(TableRow)(() => ({
    // hide last border
    '&:last-child td, &:last-child th': {
        border: 0
    }
}))

const getLocalStorageKeyName = (name, isAgentCanvas) => {
    return (isAgentCanvas ? 'agentcanvas' : 'chatflowcanvas') + '_' + name
}

export const FlowListTable = ({ data, images, isLoading, filterFunction, updateFlowsApi, setError, isAgentCanvas, isOpeaCanvas, stopSandboxApi, updateFlowToServerApi, userRole }) => {
    // overwrite setError
    setError = (error) => {
        console.error(error)
    }
    // console.log ("table user", userRole)
    const theme = useTheme()
    const customization = useSelector((state) => state.customization)

    const localStorageKeyOrder = getLocalStorageKeyName('order', isAgentCanvas)
    const localStorageKeyOrderBy = getLocalStorageKeyName('orderBy', isAgentCanvas)

    const [order, setOrder] = useState(localStorage.getItem(localStorageKeyOrder) || 'desc')
    const [orderBy, setOrderBy] = useState(localStorage.getItem(localStorageKeyOrderBy) || 'updatedDate')


    const handleRequestSort = (property) => {
        const isAsc = orderBy === property && order === 'asc'
        const newOrder = isAsc ? 'desc' : 'asc'
        setOrder(newOrder)
        setOrderBy(property)
        localStorage.setItem(localStorageKeyOrder, newOrder)
        localStorage.setItem(localStorageKeyOrderBy, property)
    }

    const [sortedData, setSortedData] = useState([]);

    const handleSortData = () => {
        if (!data) return [];
        // console.log('handleSortData', data);
        const sorted = [...data].map((row) => ({
            ...row,
            sandboxStatus: row.sandboxStatus || 'Not Running', // Ensure initial status
            deploymentStatus: row.deploymentStatus || 'Not Started' // Ensure initial deployment status
        })).sort((a, b) => {
            if (orderBy === 'name') {
                return order === 'asc' ? (a.name || '').localeCompare(b.name || '') : (b.name || '').localeCompare(a.name || '');
            } else if (orderBy === 'updatedDate') {
                return order === 'asc'
                    ? new Date(a.updatedDate) - new Date(b.updatedDate)
                    : new Date(b.updatedDate) - new Date(a.updatedDate);
            }
            return 0;
        });
        return sorted;
    };

    useEffect(() => {
        console.log("triggering websocket")
        const openConnections = [];
        const openWebSocketConnection = (id, status, type = 'sandbox') => {
            let wsEndpoint = config.sandbox_status_endpoint;
            const ws = new WebSocket(`${config.studio_server_url}/${wsEndpoint}`);
            ws.onopen = () => {
                let payload;
                payload = JSON.stringify({ id: id, status: status });
                ws.send(payload);
                console.log('Connected to WebSocket server', id, type);
            };
            ws.onmessage = (event) => {
                const data = JSON.parse(event.data);
                console.log('Deployment status:', data.status, id, type);
                
                if (data.status === 'Ready for redeployment') {
                    // Automatically trigger redeployment after namespace deletion
                    ws.close();
                    openConnections.splice(openConnections.indexOf(ws), 1);
                    updateSandboxStatus(id, 'Getting Ready');
                    // Trigger a new deployment
                    handleRunSandbox(id);
                } else if (data.status === 'Done' || data.status === 'Error' || data.status === 'Not Running' || data.status === 'Ready') {
                    ws.close();
                    openConnections.splice(openConnections.indexOf(ws), 1);
                    updateSandboxStatus(id, data.status, data.sandbox_app_url, data.sandbox_grafana_url, data.sandbox_tracer_url, data.sandbox_debuglogs_url);
                    updateFlowToServerApi(id, { sandboxStatus: data.status, sandboxAppUrl: data.sandbox_app_url, sandboxGrafanaUrl: data.sandbox_grafana_url, sandboxTracerUrl: data.sandbox_tracer_url, sandboxDebugLogsUrl: data.sandbox_debuglogs_url });
                }
            };
            ws.onclose = () => {
                console.log('Disconnected from WebSocket server', id, type);
            };
            return ws;
        };
        sortedData.map((row) => {
            // Handle sandbox websockets
            if (row.sandboxStatus === 'Getting Ready' || row.sandboxStatus === 'Stopping' || row.sandboxStatus === 'Deleting existing namespace') {
                const ws = openWebSocketConnection(row.id, row.sandboxStatus);
                openConnections.push(ws);
            }
            
            // Handle deployment websockets
            if (row.deploymentStatus === 'In Progress' && (!deployWebSocketsById[row.id] || deployWebSocketsById[row.id].readyState !== WebSocket.OPEN)) {
                console.log(`Found in-progress deployment for chatflow ${row.id}, creating websocket...`);
                
                // Parse deployment config if available
                let deploymentConfig = { hostname: '', username: '' };
                if (row.deploymentConfig) {
                    try {
                        deploymentConfig = JSON.parse(row.deploymentConfig);
                    } catch (e) {
                        console.warn('Failed to parse deployment config for websocket reconnection');
                    }
                }

                // Set initial status from existing logs
                if (row.deploymentLogs) {
                    try {
                        const logs = JSON.parse(row.deploymentLogs);
                        const logText = logs.length > 0 ? logs.join('\n') : 'Deployment in progress...';
                        setDeployStatusForId(row.id, ['Info', logText]);
                    } catch (e) {
                        setDeployStatusForId(row.id, ['Info', 'Deployment in progress...']);
                    }
                } else {
                    setDeployStatusForId(row.id, ['Info', 'Deployment in progress...']);
                }

                // Create websocket connection to monitor existing deployment
                const deployWs = startClickDeploymentMonitoring(row.id, deploymentConfig);
                openConnections.push(deployWs);
            }
        });
        return () => {
            openConnections.forEach((ws) => {
                ws.close();
            });
        };
    }, [sortedData]);

    const updateSandboxStatus = (id, newStatus, sandboxAppUrl = null, sandboxGrafanaUrl = null, sandboxTracerUrl = null, sandboxDebugLogsUrl = null) => {
        setSortedData((prevData) =>
            prevData.map((row) =>
                row.id === id
                    ? {
                          ...row,
                          sandboxStatus: newStatus,
                          sandboxAppUrl: sandboxAppUrl || row.sandboxAppUrl,
                          sandboxGrafanaUrl: sandboxGrafanaUrl || row.sandboxGrafanaUrl,
                          sandboxTracerUrl: sandboxTracerUrl || row.sandboxTracerUrl,
                          sandboxDebugLogsUrl: sandboxDebugLogsUrl || row.sandboxDebugLogsUrl
                      }
                    : row
            )
        );
    };

    const updateDeploymentStatus = (id, newStatus, deploymentConfig = null, deploymentLogs = null) => {
        setSortedData((prevData) =>
            prevData.map((row) =>
                row.id === id
                    ? {
                          ...row,
                          deploymentStatus: newStatus,
                          deploymentConfig: deploymentConfig || row.deploymentConfig,
                          deploymentLogs: deploymentLogs || row.deploymentLogs
                      }
                    : row
            )
        );
    };

    const handleRunSandbox = async (id) => {
        updateSandboxStatus(id, 'Sending Request');
        const res = await chatflowsApi.deploySandbox(id)
        updateSandboxStatus(
            id,
            res.data?.sandboxStatus || 'Error',
            res.data?.sandboxAppUrl,
            res.data?.sandboxGrafanaUrl,
            res.data?.sandboxTracerUrl,
            res.data?.sandboxDebugLogsUrl
        );
    }

    const handleStopSandbox = async (id) => {
        updateSandboxStatus(id, 'Sending Request');
        const res = await stopSandboxApi(id)
        try {
            if (res.data?.sandboxStatus) {
                updateSandboxStatus(id, res.data?.sandboxStatus)
            } else {
                throw new Error('Failed to stop sandbox')
            }
        } catch (error) {
            setError(error)
        }
    }

    const [buildDeploymentPackageDialogOpen, setBuildDeploymentPackageDialogOpen] = useState(false)
    const [buildDeploymentPackageDialogProps, setBuildDeploymentPackageDialogProps] = useState({})

    const downloadDeploymentPackage = async (id, deploymentConfig) => {
        console.log('downloadDeploymentPackage', id, deploymentConfig);
        try {
            const response = await chatflowsApi.buildDeploymentPackage(id, deploymentConfig, {
                responseType: 'arraybuffer',
            });
            const blob = new Blob([response.data], { type: 'application/zip' });
            const url = window.URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.style.display = 'none';
            a.href = url;
            a.download = `deployment_package_${id}.zip`;
            document.body.appendChild(a);
            a.click();
            window.URL.revokeObjectURL(url);
        } catch (error) {
            console.error('Error downloading deployment package:', error);
            setError(error);
        }
        setBuildDeploymentPackageDialogOpen(false)
    }

    const handleBuildDeploymentPackage = (id) => {
        setBuildDeploymentPackageDialogProps({
            id: id
        })
        setBuildDeploymentPackageDialogOpen(true)
    }

    const [oneClickDeploymentDialogOpen, setOneClickDeploymentDialogOpen] = useState(false)
    const [oneClickDeploymentDialogProps, setOneClickDeploymentDialogProps] = useState({})

    const oneClickDeployment = async (id, deploymentConfig) => {
        try {
            // Update table data to show loading icon immediately
            updateDeploymentStatus(id, 'In Progress', JSON.stringify(deploymentConfig), JSON.stringify(['Deployment initiated...']));
            
            // Proactively update database to prevent race condition on page refresh
            await chatflowsApi.updateDeploymentStatus(id, {
                status: 'In Progress',
                message: 'Deployment initiated...',
                logs: ['Deployment initiated...']
            }).catch(error => {
                console.error('Failed to update deployment status before API call:', error);
            });
            
            // Set initial deploy status
            setDeployStatusForId(id, ['Info', 'Deployment initiated...']);
            
            // Call the backend API
            const response = await chatflowsApi.clickDeployment(id, deploymentConfig);
            
            if (response.data && !response.data.error) {
                // Start WebSocket monitoring immediately after deployment is triggered
                startClickDeploymentMonitoring(id, deploymentConfig);
            }
            
            return response.data; // Pass compose_dir and other info to the dialog
        } catch (error) {
            setDeployStatusForId(id, ['Error', error?.message || 'Failed to start deployment']);
            // Update table data to remove loading icon on error
            updateDeploymentStatus(id, 'Error', null, JSON.stringify([error?.message || 'Failed to start deployment']));
            return { error: error?.message || 'Deployment failed' };
        }
    }

    const handleOneClickDeployment = (id) => {
        // Reset dialog state if switching to a different row
        if (oneClickDeploymentDialogProps.id !== id) {
            setOneClickDeploymentDialogProps({});
            setOneClickDeploymentDialogOpen(false);
            setTimeout(() => {
                setOneClickDeploymentDialogProps({ id });
                setOneClickDeploymentDialogOpen(true);
            }, 0);
        } else {
            setOneClickDeploymentDialogProps({ id });
            setOneClickDeploymentDialogOpen(true);
        }
    };

    const [deployStatusById, setDeployStatusById] = useState({});
    const [deployConfigById, setDeployConfigById] = useState({});
    const [deployWebSocketsById, setDeployWebSocketsById] = useState({}); // Store WebSocket references

    const setDeployStatusForId = (id, status) => {
        setDeployStatusById((prev) => ({ ...prev, [id]: status }));
    };

    const setDeployConfigForId = (id, config) => {
        setDeployConfigById((prev) => ({ ...prev, [id]: config }));
    };

    const setDeployWebSocketForId = (id, ws) => {
        setDeployWebSocketsById((prev) => ({ ...prev, [id]: ws }));
    };

    // Monitor click deployment WebSocket connections
    const startClickDeploymentMonitoring = useCallback((id, deploymentConfig) => {
        // Close any existing WebSocket for this ID
        if (deployWebSocketsById[id]) {
            deployWebSocketsById[id].close();
        }

        const wsUrl = `${window.location.origin.replace(/^http/, 'ws')}/studio-backend/ws/monitor-click-deployment`;
        const wsInstance = new WebSocket(wsUrl);
        
        setDeployWebSocketForId(id, wsInstance);
        
        wsInstance.onopen = () => {
            console.log('[WebSocket] Connected for click deployment monitoring', id);
            wsInstance.send(JSON.stringify({ 
                hostname: deploymentConfig.hostname, 
                username: deploymentConfig.username, 
                chatflow_id: id
            }));
        };
        
        wsInstance.onmessage = (event) => {
            let data;
            try { data = JSON.parse(event.data); } catch { return; }
            console.log('[WebSocket] Click deployment message:', data);
            
            if (data.status === 'Success') {
                setDeployStatusForId(id, ['Success', data.message]);
                // Update table data to remove loading icon
                updateDeploymentStatus(id, 'Success', null, JSON.stringify([data.message]));
                // Update database with final status
                chatflowsApi.updateDeploymentStatus(id, {
                    status: 'Success',
                    message: data.message,
                    logs: [data.message]
                }).catch(error => {
                    console.error('Failed to update deployment status in database:', error);
                });
                // Clean up WebSocket on completion
                wsInstance.close();
                setDeployWebSocketForId(id, null);
            } else if (data.status === 'Error') {
                const errorMessage = data.message;
                setDeployStatusForId(id, ['Error', errorMessage]);
                // Update table data to remove loading icon
                updateDeploymentStatus(id, 'Error', null, JSON.stringify([errorMessage]));
                // Update database with final status
                chatflowsApi.updateDeploymentStatus(id, {
                    status: 'Error',
                    message: errorMessage,
                    logs: [errorMessage]
                }).catch(error => {
                    console.error('Failed to update deployment status in database:', error);
                });
                // Clean up WebSocket on error
                wsInstance.close();
                setDeployWebSocketForId(id, null);
            } else if (data.status === 'In Progress') {
                const progressMessage = data.message || 'Deployment in progress...';
                const logs = data.logs || [];
                const logText = logs.length > 0 ? logs.join('\n') : progressMessage;
                setDeployStatusForId(id, ['Info', logText]);
                
                // Update database with progress logs
                if (logs.length > 0) {
                    chatflowsApi.updateDeploymentStatus(id, {
                        status: 'In Progress',
                        message: progressMessage,
                        logs: logs
                    }).catch(error => {
                        console.error('Failed to update In Progress deployment status:', error);
                    });
                }
            }
        };
        
        wsInstance.onerror = (error) => {
            console.error('[WebSocket] Click deployment error:', error);
            setDeployStatusForId(id, ['Error', 'Connection error during deployment monitoring']);
            wsInstance.close();
            setDeployWebSocketForId(id, null);
        };
        
        wsInstance.onclose = (event) => {
            console.log(`[WebSocket] Click deployment closed: code=${event.code}, reason='${event.reason}', wasClean=${event.wasClean}`);
            setDeployWebSocketForId(id, null);
            
            // Check deployment status if abnormal closure
            if (event.code !== 1000 && event.code !== 1001) {
                console.log('[WebSocket] Abnormal closure detected, checking deployment status...');
                setTimeout(async () => {
                    try {
                        const response = await chatflowsApi.getSpecificChatflow(id);
                        if (response.data && response.data.deploymentStatus === 'In Progress') {
                            setDeployStatusForId(id, ['Error', 'Connection lost during deployment']);
                            // Update table data to remove loading icon
                            updateDeploymentStatus(id, 'Error', null, JSON.stringify(['Connection lost during deployment']));
                            // Update database with error status
                            chatflowsApi.updateDeploymentStatus(id, {
                                status: 'Error',
                                message: 'Connection lost during deployment',
                                logs: ['Connection lost during deployment']
                            }).catch(error => {
                                console.error('Failed to update deployment status in database:', error);
                            });
                        } else if (response.data && response.data.deploymentStatus) {
                            // Deployment completed, update with final status
                            const finalStatus = response.data.deploymentStatus;
                            const logs = response.data.deploymentLogs ? 
                                JSON.parse(response.data.deploymentLogs) : 
                                [finalStatus === 'Success' ? 'Deployment completed successfully' : 'Deployment failed'];
                            const message = logs[0] || (finalStatus === 'Success' ? 'Deployment completed successfully' : 'Deployment failed');
                            setDeployStatusForId(id, [finalStatus, message]);
                            // Update table data to remove loading icon
                            updateDeploymentStatus(id, finalStatus, null, JSON.stringify(logs));
                        }
                    } catch (error) {
                        console.error('Failed to check final deployment status:', error);
                        setDeployStatusForId(id, ['Error', 'Connection lost during deployment']);
                        // Update table data to remove loading icon
                        updateDeploymentStatus(id, 'Error', null, JSON.stringify(['Connection lost during deployment']));
                    }
                }, 1000);
            }
        };
        
        return wsInstance;
    }, [deployWebSocketsById]);

    // Cleanup deployment WebSockets when component unmounts
    useEffect(() => {
        return () => {
            // Close all deployment WebSockets when component unmounts
            Object.values(deployWebSocketsById).forEach(ws => {
                if (ws && ws.readyState === WebSocket.OPEN) {
                    ws.close();
                }
            });
        };
    }, [deployWebSocketsById]);

    useEffect(() => {
        setSortedData(handleSortData());
    }, [data, order, orderBy]); // Run effect when any dependency changes


    // const handleRequestSort = (property) => {
    //     const isAsc = orderBy === property && order === 'asc';
    //     setOrder(isAsc ? 'desc' : 'asc');
    //     setOrderBy(property);
    // };

    // const sortedData = data
    //     ? [...data].sort((a, b) => {
    //           if (orderBy === 'name') {
    //               return order === 'asc' ? (a.name || '').localeCompare(b.name || '') : (b.name || '').localeCompare(a.name || '')
    //           } else if (orderBy === 'updatedDate') {
    //               return order === 'asc'
    //                   ? new Date(a.updatedDate) - new Date(b.updatedDate)
    //                   : new Date(b.updatedDate) - new Date(a.updatedDate)
    //           }
    //           return 0
    //       })
    //     : []

    const handleOpenUrl = (url) => {
        console.log('Opening URL', url);
        window.open(url, '_blank');
    }

    // Add state for observability menu
    const [observabilityAnchorEl, setObservabilityAnchorEl] = useState(null);
    const [observabilityRow, setObservabilityRow] = useState(null);

    return (
        <>
            <TableContainer sx={{ border: 1, borderColor: theme.palette.grey[900] + 25, borderRadius: 2 }} component={Paper}>
                <Table sx={{ minWidth: 650 }} size='small' aria-label='a dense table'>
                    <TableHead
                        sx={{
                            backgroundColor: customization.isDarkMode ? theme.palette.common.black : theme.palette.grey[100],
                            height: 56
                        }}
                    >
                        <TableRow>
                            <StyledTableCell component='th' scope='row' style={{ width: '20%' }} key='0'>
                                <TableSortLabel active={orderBy === 'name'} direction={order} onClick={() => handleRequestSort('name')}>
                                    Workflow Name
                                </TableSortLabel>
                            </StyledTableCell>
                            <StyledTableCell style={{ width: '15%' }} key='1b'>
                                <Stack
                                    direction={{ xs: 'column', sm: 'row' }}
                                    spacing={1}
                                    justifyContent='center'
                                >
                                    Sandbox Status
                                </Stack>
                            </StyledTableCell>
                            <StyledTableCell style={{ width: '5%' }} key='1a'>
                                <Stack
                                    direction={{ xs: 'column', sm: 'row' }}
                                    spacing={1}
                                    justifyContent='center'
                                >
                                    Sandbox Control
                                </Stack>
                            </StyledTableCell>
                            <StyledTableCell style={{ width: '5%' }} key='2'>
                                <Stack
                                    direction={{ xs: 'column', sm: 'row' }}
                                    spacing={1}
                                    justifyContent='center'
                                >
                                    Open Sandbox
                                </Stack>
                            </StyledTableCell>
                            <StyledTableCell style={{ width: '5%' }} key='3'>
                                <Stack
                                    direction={{ xs: 'column', sm: 'row' }}
                                    spacing={1}
                                    justifyContent='center'
                                >
                                    Observability
                                </Stack>
                            </StyledTableCell>
                            {/* <StyledTableCell style={{ width: '5%' }} key='5'>
                                <Stack
                                    direction={{ xs: 'column', sm: 'row' }}
                                    spacing={1}
                                    justifyContent='center'
                                >
                                    Deployment Package Generation
                                </Stack>
                            </StyledTableCell> */}
                            <StyledTableCell style={{ width: '5%' }} key='9'>
                                <Stack
                                    direction={{ xs: 'column', sm: 'row' }}
                                    spacing={1}
                                    justifyContent='center'
                                >
                                    1 Click Deployment
                                </Stack>
                            </StyledTableCell>
                            <StyledTableCell style={{ width: '5%' }} key='6'>
                                <Stack
                                    direction={{ xs: 'column', sm: 'row' }}
                                    spacing={1}
                                    justifyContent='center'
                                >
                                    Actions
                                </Stack>
                            </StyledTableCell>
                            <StyledTableCell style={{ width: '15%' }} key='7'>
                                <TableSortLabel
                                    active={orderBy === 'updatedDate'}
                                    direction={order}
                                    onClick={() => handleRequestSort('updatedDate')}
                                >
                                    Last Modified Date
                                </TableSortLabel>
                            </StyledTableCell>
                            {userRole === 'admin' &&
                                <StyledTableCell style={{ width: '15%' }} key='8'>
                                    <Stack
                                        direction={{ xs: 'column', sm: 'row' }}
                                        spacing={1}
                                    >
                                        User
                                    </Stack>
                                </StyledTableCell>}
                        </TableRow>
                    </TableHead>
                    <TableBody>
                        {isLoading ? (
                            <>
                                <StyledTableRow>
                                    <StyledTableCell>
                                        <Skeleton variant='text' />
                                    </StyledTableCell>
                                    <StyledTableCell>
                                        <Skeleton variant='text' />
                                    </StyledTableCell>
                                    <StyledTableCell>
                                        <Skeleton variant='text' />
                                    </StyledTableCell>
                                    <StyledTableCell>
                                        <Skeleton variant='text' />
                                    </StyledTableCell>
                                    <StyledTableCell>
                                        <Skeleton variant='text' />
                                    </StyledTableCell>
                                    <StyledTableCell>
                                        <Skeleton variant='text' />
                                    </StyledTableCell>
                                    <StyledTableCell>
                                        <Skeleton variant='text' />
                                    </StyledTableCell>
                                    <StyledTableCell>
                                        <Skeleton variant='text' />
                                    </StyledTableCell>
                                </StyledTableRow>
                                <StyledTableRow>
                                    <StyledTableCell>
                                        <Skeleton variant='text' />
                                    </StyledTableCell>
                                    <StyledTableCell>
                                        <Skeleton variant='text' />
                                    </StyledTableCell>
                                    <StyledTableCell>
                                        <Skeleton variant='text' />
                                    </StyledTableCell>
                                    <StyledTableCell>
                                        <Skeleton variant='text' />
                                    </StyledTableCell>
                                    <StyledTableCell>
                                        <Skeleton variant='text' />
                                    </StyledTableCell>
                                    <StyledTableCell>
                                        <Skeleton variant='text' />
                                    </StyledTableCell>
                                    <StyledTableCell>
                                        <Skeleton variant='text' />
                                    </StyledTableCell>
                                    <StyledTableCell>
                                        <Skeleton variant='text' />
                                    </StyledTableCell>
                                </StyledTableRow>
                            </>
                        ) : (
                            <>
                                {sortedData.filter(filterFunction).map((row, index) => (
                                    <StyledTableRow key={index}>
                                        <StyledTableCell key='0'>
                                            <Tooltip title={row.templateName || row.name}>
                                                <Typography
                                                    sx={{
                                                        display: '-webkit-box',
                                                        fontSize: 14,
                                                        fontWeight: 500,
                                                        WebkitLineClamp: 2,
                                                        WebkitBoxOrient: 'vertical',
                                                        textOverflow: 'ellipsis',
                                                        overflow: 'hidden'
                                                    }}
                                                >
                                                    <Link
                                                        to={`/${isAgentCanvas ? 'agentcanvas' : isOpeaCanvas ? 'opeacanvas' : 'canvas'}/${row.id}`}
                                                        style={{ color: '#1162cc', textDecoration: 'none' }}
                                                    >
                                                        {row.templateName || row.name}
                                                    </Link>
                                                </Typography>
                                            </Tooltip>
                                        </StyledTableCell>
                                        <StyledTableCell key='1b'>
                                            <Stack
                                                direction={{ xs: 'column', sm: 'row' }}
                                                spacing={1}
                                                justifyContent='center'
                                                alignItems='center'
                                            >
                                                {row.sandboxStatus === "Getting Ready" || row.sandboxStatus === "Stopping" || row.sandboxStatus === "Deleting existing namespace" || row.sandboxStatus === "Sending Request" ? (
                                                    <CircularProgress size={20} />
                                                ) : null
                                                }
                                                <Typography variant="body2">{row.sandboxStatus}</Typography>
                                            </Stack>
                                        </StyledTableCell>
                                        <StyledTableCell key='1a'>
                                            <Stack
                                                direction={{ xs: 'column', sm: 'row' }}
                                                spacing={1}
                                                justifyContent='center'
                                                alignItems='center'
                                            >
                                                {row.sandboxStatus === "Ready" || row.sandboxStatus === "Getting Ready" || row.sandboxStatus === "Deleting existing namespace" ? (
                                                    <Tooltip title="Stop Sandbox">
                                                        <Button
                                                            color='primary'
                                                            startIcon={<StopCircleOutlined />}
                                                            onClick={() => {
                                                                handleStopSandbox(row.id);
                                                            }}
                                                        >
                                                        </Button>
                                                    </Tooltip>
                                                ) : (
                                                    <Tooltip title="Run Sandbox">
                                                        <Button
                                                            color='primary'
                                                            startIcon={<PlayCircleOutline />}
                                                            onClick={() => {
                                                                window.open(`/debuglogs/sandbox-${row.id}`, '_blank');
                                                                handleRunSandbox(row.id);
                                                            }}
                                                            disabled={row.sandboxStatus === 'Stopping' || row.sandboxStatus === 'Sending Request'}
                                                        >
                                                        </Button>
                                                    </Tooltip>
                                                )}
                                            </Stack>
                                        </StyledTableCell>
                                        <StyledTableCell key='2'>

                                            <Stack
                                                direction={{ xs: 'column', sm: 'row' }}
                                                spacing={1}
                                                justifyContent='center'
                                                alignItems='center'
                                            >
                                                <Tooltip title={row.sandboxStatus === 'Ready' ? "Click to open Application UI" : "Sandbox is not running"}>
                                                    <span>
                                                        <Button
                                                            // variant="outlined"
                                                            // style={{ width: '20px' }}
                                                            color={row.sandboxStatus === 'Not Running' ? 'inherit' : 'primary'}
                                                            startIcon={<OpenInNew />}
                                                            onClick={() => {
                                                                // console.log('Button clicked for', row.name || row.id);
                                                                handleOpenUrl(row.sandboxAppUrl);
                                                            }}
                                                            disabled={row.sandboxStatus !== 'Ready'}
                                                        >
                                                        </Button>
                                                    </span>
                                                </Tooltip>
                                            </Stack>
                                        </StyledTableCell>
                                        {/* Consolidated Observability column */}
                                        <StyledTableCell key='3'>
                                            <Stack
                                                direction={{ xs: 'column', sm: 'row' }}
                                                spacing={1}
                                                justifyContent='center'
                                                alignItems='center'
                                            >
                                                <Tooltip title={row.sandboxStatus === 'Ready' ? "Observability Options" : "Sandbox is not running"}>
                                                    <span>
                                                        <Button
                                                            color={row.sandboxStatus === 'Not Running' ? 'inherit' : 'primary'}
                                                            startIcon={<TroubleshootOutlined />}
                                                            disabled={row.sandboxStatus !== 'Ready'}
                                                            aria-controls={`observability-menu-${row.id}`}
                                                            aria-haspopup="true"
                                                            onClick={(event) => {
                                                                setObservabilityAnchorEl(event.currentTarget);
                                                                setObservabilityRow(row);
                                                            }}
                                                        >
                                                        </Button>
                                                    </span>
                                                </Tooltip>
                                                <Menu
                                                    id={`observability-menu-${row.id}`}
                                                    anchorEl={observabilityAnchorEl}
                                                    open={Boolean(observabilityAnchorEl) && observabilityRow?.id === row.id}
                                                    onClose={() => setObservabilityAnchorEl(null)}
                                                >
                                                    <MenuItem
                                                        sx={{ color: 'primary.main' }}
                                                        onClick={() => {
                                                            handleOpenUrl(row.sandboxGrafanaUrl);
                                                            setObservabilityAnchorEl(null);
                                                        }}
                                                        disabled={row.sandboxStatus !== 'Ready'}
                                                    >
                                                        <Analytics fontSize="small" sx={{ mr: 1 }} /> Monitoring Dashboard
                                                    </MenuItem>
                                                    <MenuItem
                                                        sx={{ color: 'primary.main' }}
                                                        onClick={() => {
                                                            handleOpenUrl(row.sandboxTracerUrl);
                                                            setObservabilityAnchorEl(null);
                                                        }}
                                                        disabled={row.sandboxStatus !== 'Ready'}
                                                    >
                                                        <ViewTimelineOutlined fontSize="small" sx={{ mr: 1, transform: 'scaleX(-1)' }} /> LLM Call Traces
                                                    </MenuItem>
                                                    <MenuItem
                                                        sx={{ color: 'primary.main' }}
                                                        onClick={() => {
                                                            handleOpenUrl(row.sandboxDebugLogsUrl);
                                                            setObservabilityAnchorEl(null);
                                                        }}
                                                        disabled={row.sandboxStatus !== 'Ready'}
                                                    >
                                                        <TerminalOutlined fontSize="small" sx={{ mr: 1 }} /> Debug Logs
                                                    </MenuItem>
                                                </Menu>
                                            </Stack>
                                        </StyledTableCell>
                                        {/* <StyledTableCell key='5'>
                                            <Stack
                                                direction={{ xs: 'column', sm: 'row' }}
                                                spacing={1}
                                                justifyContent='center'
                                                alignItems='center'
                                            >
                                                <Tooltip title={"Generate Deployment Package"}>
                                                    <span>
                                                        <Button
                                                            startIcon={<UnarchiveOutlined />}
                                                            onClick={() => {
                                                                handleBuildDeploymentPackage(row.id);
                                                            }}
                                                        >
                                                        </Button>
                                                    </span>
                                                </Tooltip>
                                            </Stack>
                                        </StyledTableCell> */}
                                        <StyledTableCell key='9'>
                                            <Stack
                                                direction={{ xs: 'column', sm: 'row' }}
                                                spacing={1}
                                                justifyContent='center'
                                                alignItems='center'
                                            >
                                                {row.deploymentStatus === 'In Progress' || 
                                                 (deployWebSocketsById[row.id] && deployWebSocketsById[row.id].readyState === WebSocket.OPEN) ? (
                                                    <Tooltip title="Deployment in progress - click to monitor">
                                                        <Button
                                                            startIcon={<CircularProgress size={16} />}
                                                            onClick={() => {
                                                                handleOneClickDeployment(row.id);
                                                            }}
                                                            color="primary"
                                                            variant="outlined"
                                                        >
                                                        </Button>
                                                    </Tooltip>
                                                ) : (
                                                    <Tooltip title={"1 Click Deployment"}>
                                                        <span>
                                                            <Button
                                                                startIcon={<InstallDesktopOutlined />}
                                                                onClick={() => {
                                                                    handleOneClickDeployment(row.id);
                                                                }}
                                                            >
                                                            </Button>
                                                        </span>
                                                    </Tooltip>
                                                )}
                                            </Stack>
                                        </StyledTableCell>
                                        <StyledTableCell key='6'>
                                            <Stack
                                                direction={{ xs: 'column', sm: 'row' }}
                                                spacing={1}
                                                justifyContent='center'
                                                alignItems='center'
                                            >
                                                <FlowListMenu
                                                    isAgentCanvas={isAgentCanvas}
                                                    chatflow={row}
                                                    setError={setError}
                                                    updateFlowsApi={updateFlowsApi}
                                                    sandboxStatus={row.sandboxStatus}
                                                    updateSandboxStatus={updateSandboxStatus}
                                                />
                                            </Stack>
                                        </StyledTableCell>
                                        <StyledTableCell key='7'>{moment(row.updatedDate).format('MMMM Do, YYYY')}</StyledTableCell>
                                        {userRole == 'admin' && <StyledTableCell key='8'>{row.userid}</StyledTableCell>}

                                    </StyledTableRow>
                                ))}
                            </>
                        )}
                    </TableBody>
                </Table>
            </TableContainer>
            <BuildDeploymentPackageDialog
                show={buildDeploymentPackageDialogOpen}
                dialogProps={buildDeploymentPackageDialogProps}
                onCancel={() => setBuildDeploymentPackageDialogOpen(false)}
                onConfirm={downloadDeploymentPackage}
            />
            <OneClickDeploymentDialog
                key={oneClickDeploymentDialogProps.id || 'none'}
                show={oneClickDeploymentDialogOpen}
                dialogProps={oneClickDeploymentDialogProps}
                onCancel={() => setOneClickDeploymentDialogOpen(false)}
                onConfirm={oneClickDeployment}
                deployStatus={deployStatusById[oneClickDeploymentDialogProps.id]}
                setDeployStatus={(status) => setDeployStatusForId(oneClickDeploymentDialogProps.id, status)}
                deploymentConfig={deployConfigById[oneClickDeploymentDialogProps.id] || { hostname: '', username: '' }}
                setDeploymentConfig={(config) => setDeployConfigForId(oneClickDeploymentDialogProps.id, config)}
                deployWebSocket={deployWebSocketsById[oneClickDeploymentDialogProps.id]}
            />
        </>
    )
}

FlowListTable.propTypes = {
    data: PropTypes.array,
    images: PropTypes.object,
    isLoading: PropTypes.bool,
    filterFunction: PropTypes.func,
    updateFlowsApi: PropTypes.object,
    setError: PropTypes.func,
    isAgentCanvas: PropTypes.bool,
    isOpeaCanvas: PropTypes.bool,
    stopSandboxApi: PropTypes.func,
}
