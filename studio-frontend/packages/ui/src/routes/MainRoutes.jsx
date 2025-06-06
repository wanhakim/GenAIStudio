import { lazy } from 'react'

// project imports
import MainLayout from '@/layout/MainLayout'
import Loadable from '@/ui-component/loading/Loadable'

// chatflows routing
const Opeaflows = Loadable(lazy(() => import('@/views/opeaflows')))

// tracer routing
const Tracer = Loadable(lazy(() => import('@/views/tracer')))

// debuglogs routing
const Debuglogs = Loadable(lazy(() => import('@/views/debuglogs')))

// chatflows routing
const Chatflows = Loadable(lazy(() => import('@/views/chatflows')))

// agents routing
const Agentflows = Loadable(lazy(() => import('@/views/agentflows')))

// marketplaces routing
const Marketplaces = Loadable(lazy(() => import('@/views/marketplaces')))

// apikey routing
const APIKey = Loadable(lazy(() => import('@/views/apikey')))

// tools routing
const Tools = Loadable(lazy(() => import('@/views/tools')))

// assistants routing
const Assistants = Loadable(lazy(() => import('@/views/assistants')))

// credentials routing
const Credentials = Loadable(lazy(() => import('@/views/credentials')))

// variables routing
const Variables = Loadable(lazy(() => import('@/views/variables')))

// documents routing
const Documents = Loadable(lazy(() => import('@/views/docstore')))
const DocumentStoreDetail = Loadable(lazy(() => import('@/views/docstore/DocumentStoreDetail')))
const ShowStoredChunks = Loadable(lazy(() => import('@/views/docstore/ShowStoredChunks')))
const LoaderConfigPreviewChunks = Loadable(lazy(() => import('@/views/docstore/LoaderConfigPreviewChunks')))
const VectorStoreConfigure = Loadable(lazy(() => import('@/views/docstore/VectorStoreConfigure')))
const VectorStoreQuery = Loadable(lazy(() => import('@/views/docstore/VectorStoreQuery')))

// ==============================|| MAIN ROUTING ||============================== //

const MainRoutes = {
    path: '/',
    element: <MainLayout />,
    children: [
        {
            path: '/',
            element: <Opeaflows />
        },
        {
            path: '/opeaflows',
            element: <Opeaflows />
        },
        {
            path:'/tracer/:ns',
            element: <Tracer />
        },
        {
            path:'/debuglogs/:ns',
            element: <Debuglogs />
        },
        {
            path: '/chatflows',
            element: <Chatflows />
        },
        {
            path: '/agentflows',
            element: <Agentflows />
        },
        {
            path: '/marketplaces',
            element: <Marketplaces />
        },
        {
            path: '/apikey',
            element: <APIKey />
        },
        {
            path: '/tools',
            element: <Tools />
        },
        {
            path: '/assistants',
            element: <Assistants />
        },
        {
            path: '/credentials',
            element: <Credentials />
        },
        {
            path: '/variables',
            element: <Variables />
        },
        {
            path: '/document-stores',
            element: <Documents />
        },
        {
            path: '/document-stores/:id',
            element: <DocumentStoreDetail />
        },
        {
            path: '/document-stores/chunks/:id/:id',
            element: <ShowStoredChunks />
        },
        {
            path: '/document-stores/:id/:name',
            element: <LoaderConfigPreviewChunks />
        },
        {
            path: '/document-stores/vector/:id',
            element: <VectorStoreConfigure />
        },
        {
            path: '/document-stores/query/:id',
            element: <VectorStoreQuery />
        }
    ]
}

export default MainRoutes
