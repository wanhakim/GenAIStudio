import { useState, useEffect } from "react";
import { useParams } from "react-router-dom";
import {
    Table,
    TableBody,
    TableCell,
    TableContainer,
    TableHead,
    TableRow,
    Paper,
    Button,
    Box,
    Typography,
    Divider,
    Fade,
    Modal,
    Backdrop
} from "@mui/material";
import { styled } from "@mui/material/styles";
import { tableCellClasses } from "@mui/material/TableCell";

const StyledTableCell = styled(TableCell)(({ theme }) => ({
    borderColor: theme.palette.grey[900] + 25,
    [`&.${tableCellClasses.head}`]: {
        color: theme.palette.grey[900]
    },
    [`&.${tableCellClasses.body}`]: {
        fontSize: 14,
        height: 64
    }
}));

const StyledTableRow = styled(TableRow)(() => ({
    '&:last-child td, &:last-child th': {
        border: 0
    }
}));

export default function PodLogsView() {
    const [autoRefresh, setAutoRefresh] = useState(true);
    const [podsData, setPodsData] = useState({ namespace: '', pods: [] });
    const [selectedPodLogs, setSelectedPodLogs] = useState(null);
    const [selectedPodEvents, setSelectedPodEvents] = useState(null);

    const { ns } = useParams();
    console.log("ns: ", ns);

    const debuglog_endpoint = '/studio-backend/podlogs';

    const fetchPodsData = async (ns) => {
        console.log("fetchPodsData", ns);
        const url = `${debuglog_endpoint}/${ns}`;
        try {
            const response = await fetch(url, { headers: { "Content-Type": "application/json" } });
            const data = await response.json();
            setPodsData(data);
        } catch (error) {
            console.error("Failed to fetch pods data:", error);
        }
    };

    useEffect(() => {
        fetchPodsData();
    }, []);

    useEffect(() => {
        if (!autoRefresh) return;
        const interval = setInterval(() => {
            fetchPodsData();
        }, 5000); // Refresh every 5 seconds
        return () => clearInterval(interval);
    }, [autoRefresh]);

    const toggleAutoRefresh = () => {
        setAutoRefresh(!autoRefresh);
    };

    const handleExpandLogs = (podName) => {
        setSelectedPodLogs(podName);
    };

    const handleExpandEvents = (podName) => {
        setSelectedPodEvents(podName);
    };

    const selectedLogPod = podsData.pods.find(p => p.name === selectedPodLogs);
    const selectedEventPod = podsData.pods.find(p => p.name === selectedPodEvents);

    return (
        <Box sx={{ p: 4 }}>
            <Typography variant="h6">Workflow Name</Typography>
            <Typography variant="body2" color="text.secondary">Namespace: {podsData.namespace}</Typography>

            <Box sx={{ my: 2 }}>
                <Typography variant="body1" component="span">Auto refresh: </Typography>
                <Button variant="outlined" size="small" onClick={toggleAutoRefresh}>
                    {autoRefresh ? 'ON' : 'OFF'}
                </Button>
            </Box>

            <TableContainer component={Paper} sx={{ border: 1, borderColor: "grey.900", borderRadius: 2 }}>
                <Table size="small">
                    <TableHead>
                        <StyledTableRow>
                            <StyledTableCell>Pod Name</StyledTableCell>
                            <StyledTableCell>Pod Status</StyledTableCell>
                            <StyledTableCell>Pod Events</StyledTableCell>
                            <StyledTableCell>Pod Logs</StyledTableCell>
                        </StyledTableRow>
                    </TableHead>
                    <TableBody>
                        {podsData.pods.map((pod) => (
                            <StyledTableRow key={pod.name}>
                                <StyledTableCell>{pod.name}</StyledTableCell>
                                <StyledTableCell>{pod.status}</StyledTableCell>
                                <StyledTableCell>
                                    {pod.events.length > 0 ? (
                                        <Button variant="outlined" size="small" onClick={() => handleExpandEvents(pod.name)}>Expand</Button>
                                    ) : (
                                        <Typography variant="body2" color="text.secondary">No events</Typography>
                                    )}
                                </StyledTableCell>
                                <StyledTableCell>
                                    {pod.logs && pod.logs.length > 0 && (
                                        <Button variant="outlined" size="small" onClick={() => handleExpandLogs(pod.name)}>Expand</Button>
                                    )}
                                </StyledTableCell>
                            </StyledTableRow>
                        ))}
                    </TableBody>
                </Table>
            </TableContainer>

            <Modal
                open={!!selectedPodLogs}
                onClose={() => setSelectedPodLogs(null)}
                closeAfterTransition
                BackdropComponent={Backdrop}
                BackdropProps={{ timeout: 500 }}
            >
                <Fade in={!!selectedPodLogs}>
                    <Box sx={{ position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%, -50%)', width: '70%', maxHeight: '80%', bgcolor: 'background.paper', borderRadius: 2, boxShadow: 24, p: 4, overflow: 'auto' }}>
                        <Typography variant="h6" gutterBottom>{selectedLogPod?.name} Logs</Typography>
                        <Divider sx={{ my: 1 }} />
                        <pre style={{ whiteSpace: 'pre-wrap', wordWrap: 'break-word' }}>
                            {selectedLogPod?.logs?.join('\n') || 'No logs available'}
                        </pre>
                        <Box mt={2} textAlign="right">
                            <Button variant="contained" onClick={() => setSelectedPodLogs(null)}>Close</Button>
                        </Box>
                    </Box>
                </Fade>
            </Modal>

            <Modal
                open={!!selectedPodEvents}
                onClose={() => setSelectedPodEvents(null)}
                closeAfterTransition
                BackdropComponent={Backdrop}
                BackdropProps={{ timeout: 500 }}
            >
                <Fade in={!!selectedPodEvents}>
                    <Box sx={{ position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%, -50%)', width: '60%', maxHeight: '80%', bgcolor: 'background.paper', borderRadius: 2, boxShadow: 24, p: 4, overflow: 'auto' }}>
                        <Typography variant="h6" gutterBottom>{selectedEventPod?.name} Events</Typography>
                        <Divider sx={{ my: 1 }} />
                        <pre style={{ whiteSpace: 'pre-wrap', wordWrap: 'break-word' }}>
                            {selectedEventPod?.events?.join('\n') || 'No events available'}
                        </pre>
                        <Box mt={2} textAlign="right">
                            <Button variant="contained" onClick={() => setSelectedPodEvents(null)}>Close</Button>
                        </Box>
                    </Box>
                </Fade>
            </Modal>
        </Box>
    );
}