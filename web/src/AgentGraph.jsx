import { useCallback, useEffect, useState } from 'react'
import {
  ReactFlow,
  Controls,
  Background,
  useNodesState,
  useEdgesState,
  MarkerType,
  Handle,
  Position,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'

// Custom node component for agents
function AgentNode({ data, selected }) {
  const isManager = data.type === 'manager'
  const isActive = data.isActive
  const isHighlighted = data.isHighlighted

  return (
    <div
      className={`agent-node ${isManager ? 'manager' : 'worker'} ${isActive ? 'active' : ''} ${isHighlighted ? 'highlighted' : ''} ${selected ? 'selected' : ''}`}
      style={{
        '--node-color': data.color,
        '--node-color-light': `${data.color}20`,
      }}
    >
      {!isManager && (
        <Handle type="target" position={Position.Top} className="agent-handle" />
      )}

      <div className="agent-node-icon">
        {isManager ? '🎯' : data.id === 'tech' ? '💻' : data.id === 'hr' ? '👥' : '🎨'}
      </div>

      <div className="agent-node-content">
        <div className="agent-node-name">{data.name}</div>
        <div className="agent-node-desc">{data.description}</div>
      </div>

      {isActive && (
        <div className="agent-node-pulse" />
      )}

      {isManager && (
        <Handle type="source" position={Position.Bottom} className="agent-handle" />
      )}
    </div>
  )
}

const nodeTypes = {
  agent: AgentNode,
}

export default function AgentGraph({ isOpen, onClose, activeAgent, highlightedAgent, routingHistory }) {
  const [nodes, setNodes, onNodesChange] = useNodesState([])
  const [edges, setEdges, onEdgesChange] = useEdgesState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  // Fetch topology on mount
  useEffect(() => {
    async function fetchTopology() {
      try {
        const response = await fetch('/topology')
        if (!response.ok) {
          throw new Error('Failed to fetch topology')
        }
        const data = await response.json()

        // Transform nodes for ReactFlow
        const flowNodes = data.nodes.map((node) => ({
          id: node.id,
          type: 'agent',
          position: node.position,
          data: {
            ...node,
            isActive: false,
          },
        }))

        // Transform edges for ReactFlow
        const flowEdges = data.edges.map((edge) => ({
          id: edge.id,
          source: edge.source,
          target: edge.target,
          label: edge.label,
          type: 'smoothstep',
          animated: false,
          style: { stroke: '#94a3b8', strokeWidth: 2 },
          labelStyle: { fill: '#64748b', fontWeight: 500, fontSize: 12 },
          labelBgStyle: { fill: '#f8fafc', fillOpacity: 0.9 },
          markerEnd: {
            type: MarkerType.ArrowClosed,
            color: '#94a3b8',
          },
        }))

        setNodes(flowNodes)
        setEdges(flowEdges)
        setLoading(false)
      } catch (err) {
        console.error('Error fetching topology:', err)
        setError(err.message)
        setLoading(false)
      }
    }

    if (isOpen) {
      fetchTopology()
    }
  }, [isOpen, setNodes, setEdges])

  // Update active node when routing changes
  useEffect(() => {
    const targetAgent = highlightedAgent || activeAgent
    if (!targetAgent) return

    setNodes((nds) =>
      nds.map((node) => ({
        ...node,
        data: {
          ...node.data,
          isActive: node.id === targetAgent || node.id === 'manager',
          isHighlighted: highlightedAgent && (node.id === highlightedAgent || node.id === 'manager'),
        },
      }))
    )

    // Animate the edge to the active/highlighted agent
    // Use red for highlighted (clicked badge), blue for active (latest)
    const isHighlightMode = !!highlightedAgent
    setEdges((eds) =>
      eds.map((edge) => {
        const isTargetEdge = edge.target === targetAgent
        return {
          ...edge,
          animated: isTargetEdge,
          style: {
            ...edge.style,
            stroke: isTargetEdge
              ? (isHighlightMode ? '#ef4444' : '#3b82f6')
              : '#94a3b8',
            strokeWidth: isTargetEdge ? 4 : 2,
          },
          markerEnd: {
            type: MarkerType.ArrowClosed,
            color: isTargetEdge
              ? (isHighlightMode ? '#ef4444' : '#3b82f6')
              : '#94a3b8',
          },
        }
      })
    )
  }, [activeAgent, highlightedAgent, setNodes, setEdges])

  if (!isOpen) return null

  return (
    <div className={`agent-graph-panel ${isOpen ? 'open' : ''}`}>
      <div className="agent-graph-header">
        <h3>Agent Routing Visualization</h3>
        <button className="agent-graph-close" onClick={onClose}>
          &times;
        </button>
      </div>

      <div className="agent-graph-container">
        {loading && (
          <div className="agent-graph-loading">
            <div className="loading-spinner"></div>
            <span>Loading topology...</span>
          </div>
        )}

        {error && (
          <div className="agent-graph-error">
            <p>Failed to load agent topology</p>
            <small>{error}</small>
          </div>
        )}

        {!loading && !error && (
          <ReactFlow
            nodes={nodes}
            edges={edges}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            nodeTypes={nodeTypes}
            fitView
            fitViewOptions={{ padding: 0.3 }}
            proOptions={{ hideAttribution: true }}
          >
            <Background color="#e2e8f0" gap={16} />
            <Controls showInteractive={false} />
          </ReactFlow>
        )}
      </div>

      {routingHistory && routingHistory.length > 0 && (
        <div className="agent-graph-history">
          <h4>Routing History</h4>
          <ul>
            {routingHistory.slice(-5).map((item, idx) => (
              <li key={idx} className="routing-history-item">
                <span className="routing-history-dot" style={{ backgroundColor: item.color }} />
                <span className="routing-history-text">
                  {item.question.substring(0, 30)}... → <strong>{item.agent}</strong>
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}
