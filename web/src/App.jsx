import { useState, useRef, useEffect } from 'react'
import './App.css'
import A2AClient from './a2aClient'
import AgentGraph from './AgentGraph'

// Parse routing metadata from response
function parseRoutingMetadata(response) {
  const metadataMatch = response.match(/<!-- ROUTING_METADATA:(.*?):END_ROUTING_METADATA -->/)
  if (metadataMatch) {
    try {
      const metadata = JSON.parse(metadataMatch[1])
      const cleanResponse = response.replace(/<!-- ROUTING_METADATA:.*?:END_ROUTING_METADATA -->/, '').trim()
      return { metadata, cleanResponse }
    } catch (e) {
      console.error('Failed to parse routing metadata:', e)
    }
  }
  return { metadata: null, cleanResponse: response }
}

function App() {
  const [messages, setMessages] = useState([])
  const [inputValue, setInputValue] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState(null)
  const [conversationHistory, setConversationHistory] = useState([])
  const [showGraph, setShowGraph] = useState(false)
  const [activeAgent, setActiveAgent] = useState(null)
  const [highlightedAgent, setHighlightedAgent] = useState(null)
  const [routingHistory, setRoutingHistory] = useState([])
  const messagesEndRef = useRef(null)
  const a2aClientRef = useRef(new A2AClient('/api'))

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }

  useEffect(() => {
    scrollToBottom()
  }, [messages])

  const sendMessage = async (e) => {
    e.preventDefault()
    if (!inputValue.trim()) return

    const userMessage = inputValue.trim()
    setInputValue('')
    setMessages(prev => [...prev, { role: 'user', content: userMessage }])
    setIsLoading(true)
    setError(null)

    try {
      // Prepare the message with conversation history for A2A
      const messagePayload = {
        current_question: userMessage,
        conversation_history: conversationHistory
      }

      // Send message via A2A protocol
      const rawResponse = await a2aClientRef.current.sendMessage(JSON.stringify(messagePayload))

      // Parse routing metadata from response
      const { metadata, cleanResponse } = parseRoutingMetadata(rawResponse)

      let routing = null
      let routingInfo = null

      if (metadata?.routing) {
        routing = metadata.routing.decision
        routingInfo = metadata.routing
        setActiveAgent(metadata.routing.to.id)

        // Add to routing history
        setRoutingHistory(prev => [...prev, {
          question: userMessage,
          agent: metadata.routing.to.name,
          color: metadata.routing.to.color,
          timestamp: new Date().toISOString()
        }])
      }

      setMessages(prev => [...prev, {
        role: 'assistant',
        content: cleanResponse,
        routing: routing,
        routingInfo: routingInfo
      }])

      // Update conversation history
      setConversationHistory(prev => [
        ...prev,
        { role: 'user', content: userMessage },
        { role: 'assistant', content: cleanResponse }
      ])
    } catch (err) {
      setError(`Error: ${err.message}`)
      setMessages(prev => [...prev, {
        role: 'error',
        content: `Failed to send message: ${err.message}`
      }])
    } finally {
      setIsLoading(false)
    }
  }

  const clearHistory = () => {
    setMessages([])
    setConversationHistory([])
    setRoutingHistory([])
    setActiveAgent(null)
    setHighlightedAgent(null)
    setError(null)
  }

  // Handle clicking on a routing badge - highlight that path in red
  const handleRoutingBadgeClick = (agentId) => {
    setShowGraph(true)
    setHighlightedAgent(agentId)
    // Clear highlight after 3 seconds
    setTimeout(() => setHighlightedAgent(null), 3000)
  }

  return (
    <div className={`app-layout ${showGraph ? 'graph-open' : ''}`}>
      <div className="chat-container">
        <header className="chat-header">
          <div className="header-content">
            <div>
              <h1>A2A Multi-Agent Chat</h1>
              <p className="subtitle">Chat with AI experts (HR, Tech & Design)</p>
            </div>
            <button
              className={`graph-toggle-btn ${showGraph ? 'active' : ''}`}
              onClick={() => setShowGraph(!showGraph)}
              title="Toggle routing visualization"
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <circle cx="12" cy="5" r="3" />
                <circle cx="5" cy="19" r="3" />
                <circle cx="19" cy="19" r="3" />
                <line x1="12" y1="8" x2="5" y2="16" />
                <line x1="12" y1="8" x2="19" y2="16" />
              </svg>
              <span>Routing</span>
            </button>
          </div>
        </header>

        <div className="messages-wrapper">
          {messages.length === 0 && (
            <div className="empty-state">
              <h2>Welcome to A2A Multi-Agent Demo</h2>
              <p>Ask your question about HR, technical, or design topics.</p>
              <p>The system will automatically route your question to the appropriate expert.</p>
              <button
                className="view-agents-btn"
                onClick={() => setShowGraph(true)}
              >
                View Agent Network
              </button>
            </div>
          )}

          <div className="messages">
            {messages.map((msg, idx) => (
              <div key={idx} className={`message message-${msg.role}`}>
                <div className="message-content">
                  <p>{msg.content}</p>
                  {msg.routingInfo && (
                    <div
                      className="routing-badge"
                      style={{ '--badge-color': msg.routingInfo.to.color }}
                      onClick={() => handleRoutingBadgeClick(msg.routingInfo.to.id)}
                    >
                      <span className="routing-badge-dot" />
                      <span>Routed to {msg.routingInfo.to.name}</span>
                    </div>
                  )}
                </div>
              </div>
            ))}
            {isLoading && (
              <div className="message message-loading">
                <div className="loading-spinner"></div>
                <span>Routing & processing...</span>
              </div>
            )}
            {error && (
              <div className="message message-error">
                <p>{error}</p>
              </div>
            )}
            <div ref={messagesEndRef} />
          </div>
        </div>

        <footer className="chat-footer">
          <form onSubmit={sendMessage} className="input-form">
            <input
              type="text"
              value={inputValue}
              onChange={(e) => setInputValue(e.target.value)}
              placeholder="Type your question..."
              disabled={isLoading}
              className="message-input"
            />
            <button
              type="submit"
              disabled={isLoading || !inputValue.trim()}
              className="send-button"
            >
              Send
            </button>
          </form>
          {messages.length > 0 && (
            <button
              onClick={clearHistory}
              className="clear-button"
            >
              Clear History
            </button>
          )}
        </footer>
      </div>

      <AgentGraph
        isOpen={showGraph}
        onClose={() => { setShowGraph(false); setHighlightedAgent(null); }}
        activeAgent={activeAgent}
        highlightedAgent={highlightedAgent}
        routingHistory={routingHistory}
      />
    </div>
  )
}

export default App
