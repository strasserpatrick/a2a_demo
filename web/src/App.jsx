import { useState, useRef, useEffect } from 'react'
import './App.css'
import A2AClient from './a2aClient'

function App() {
  const [messages, setMessages] = useState([])
  const [inputValue, setInputValue] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState(null)
  const [conversationHistory, setConversationHistory] = useState([])
  const messagesEndRef = useRef(null)
  const a2aClientRef = useRef(new A2AClient('http://localhost:8002'))

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
      const result = await a2aClientRef.current.sendMessage(JSON.stringify(messagePayload))

      // Extract the response from the A2A result
      let assistantMessage = 'No response received'
      let routing = null

      // Parse the result based on A2A response structure
      if (result.output) {
        assistantMessage = result.output
      } else if (result.artifacts && result.artifacts.length > 0) {
        const artifact = result.artifacts[0]
        if (artifact.parts && artifact.parts.length > 0) {
          const part = artifact.parts[0]
          if (part.text) {
            assistantMessage = part.text
          }
        }
      }

      // Try to extract routing info from the response
      if (assistantMessage.includes('TECH') || assistantMessage.includes('Tech Expert')) {
        routing = 'TECH'
      } else if (assistantMessage.includes('HR') || assistantMessage.includes('HR Expert')) {
        routing = 'HR'
      }

      setMessages(prev => [...prev, {
        role: 'assistant',
        content: assistantMessage,
        routing: routing
      }])

      // Update conversation history
      setConversationHistory(prev => [
        ...prev,
        { role: 'user', content: userMessage },
        { role: 'assistant', content: assistantMessage }
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
    setError(null)
  }

  return (
    <div className="chat-container">
      <header className="chat-header">
        <h1>A2A Multi-Agent Chat</h1>
        <p className="subtitle">Chat with AI experts (HR & Tech)</p>
      </header>

      <div className="messages-wrapper">
        {messages.length === 0 && (
          <div className="empty-state">
            <h2>Welcome to A2A Multi-Agent Demo</h2>
            <p>Ask your question about HR or technical topics.</p>
            <p>The system will automatically route your question to the appropriate expert.</p>
          </div>
        )}

        <div className="messages">
          {messages.map((msg, idx) => (
            <div key={idx} className={`message message-${msg.role}`}>
              <div className="message-content">
                <p>{msg.content}</p>
                {msg.routing && (
                  <div className="routing-info">
                    Routed to: <strong>{msg.routing}</strong>
                  </div>
                )}
              </div>
            </div>
          ))}
          {isLoading && (
            <div className="message message-loading">
              <div className="loading-spinner"></div>
              <span>Thinking...</span>
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
  )
}

export default App
