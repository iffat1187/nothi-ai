import { useCallback, useEffect, useRef, useState } from 'react'
import { Ellipsis, FolderCheck, Menu, MessageSquare, Plus, Trash2 } from 'lucide-react'
import ChatView from './ChatView.jsx'
import DeleteChatDialog from './DeleteChatDialog.jsx'
import ThemeToggle from './ThemeToggle.jsx'
import { request } from './chat-api.js'
import './App.css'

const activeChatKey = 'nothi-active-chat'
const desktopQuery = '(min-width: 760px)'

function App() {
  const [sidebarOpen, setSidebarOpen] = useState(() => window.matchMedia(desktopQuery).matches)
  const [chats, setChats] = useState([])
  const [activeId, setActiveId] = useState(null)
  const [starting, setStarting] = useState(true)
  const [connected, setConnected] = useState(false)
  const [creating, setCreating] = useState(false)
  const [startupError, setStartupError] = useState('')
  const [attempt, setAttempt] = useState(0)
  const [openMenuId, setOpenMenuId] = useState(null)
  const [deleteTarget, setDeleteTarget] = useState(null)
  const deletedChats = useRef(new Set())

  const selectChat = useCallback(id => {
    localStorage.setItem(activeChatKey, id ?? '')
    setActiveId(id)
  }, [])

  const updateSummary = useCallback(({ id, title, updatedAt }) => {
    setChats(previous => {
      if (deletedChats.current.has(id)) return previous
      return [{ id, title, updatedAt }, ...previous.filter(chat => chat.id !== id)]
        .sort((a, b) => b.updatedAt - a.updatedAt)
    })
  }, [])

  useEffect(() => {
    const controller = new AbortController()

    async function start() {
      try {
        const list = await request('/api/chats', { signal: controller.signal })
        if (controller.signal.aborted) return

        setChats(list)
        const savedId = localStorage.getItem(activeChatKey)
        let chat = list.find(item => item.id === savedId) ?? list[0]
        if (!chat && savedId !== '') {
          chat = await request('/api/chats', { method: 'POST', signal: controller.signal })
        }
        if (controller.signal.aborted) return

        if (!list.length && chat) updateSummary(chat)
        selectChat(chat?.id ?? null)
        setConnected(true)
      } catch (error) {
        if (!controller.signal.aborted) {
          setConnected(false)
          setStartupError(error.message)
        }
      } finally {
        if (!controller.signal.aborted) setStarting(false)
      }
    }

    start()
    return () => controller.abort()
  }, [attempt, selectChat, updateSummary])

  useEffect(() => {
    if (!openMenuId) return
    function closeOutside(event) {
      if (event.target instanceof Element && !event.target.closest('.chat-actions-toggle, .chat-actions-menu')) {
        setOpenMenuId(null)
      }
    }
    document.addEventListener('pointerdown', closeOutside)
    return () => document.removeEventListener('pointerdown', closeOutside)
  }, [openMenuId])

  function openChat(id) {
    setOpenMenuId(null)
    selectChat(id)
    if (!window.matchMedia(desktopQuery).matches) setSidebarOpen(false)
  }

  async function newChat() {
    setOpenMenuId(null)
    setCreating(true)
    setStartupError('')
    try {
      const chat = await request('/api/chats', { method: 'POST' })
      updateSummary(chat)
      openChat(chat.id)
    } catch (error) {
      setStartupError(error.message)
    } finally {
      setCreating(false)
    }
  }

  function cancelDelete() {
    setDeleteTarget(null)
    requestAnimationFrame(() => document.getElementById('chat-actions-' + deleteTarget.id)?.focus())
  }

  async function deleteChat(id) {
    await request('/api/chats/' + id, { method: 'DELETE' })
    deletedChats.current.add(id)
    setChats(previous => previous.filter(chat => chat.id !== id))

    const nextId = activeId === id ? chats.find(chat => chat.id !== id)?.id ?? null : activeId
    if (activeId === id) selectChat(nextId)
    setDeleteTarget(null)
    requestAnimationFrame(() => {
      document.getElementById(nextId ? 'chat-select-' + nextId : 'sidebar-new-chat')?.focus()
    })
  }

  return (
    <div className="app">
      <header className="app-header">
        <div className="header-brand">
          <button
            className="icon-button menu-toggle"
            type="button"
            aria-label={sidebarOpen ? 'Hide chat sidebar' : 'Show chat sidebar'}
            aria-expanded={sidebarOpen}
            aria-controls="chat-sidebar"
            onClick={() => {
              setOpenMenuId(null)
              setSidebarOpen(open => !open)
            }}
          >
            <Menu size={20} aria-hidden="true" />
          </button>
          <FolderCheck className="brand-mark" size={26} strokeWidth={1.65} aria-hidden="true" />
          <h1>Nothi AI</h1>
          <span className="brand-bangla" lang="bn">নথি এআই</span>
        </div>
        <div className="header-tools">
          <p className={connected ? 'api-status connected' : 'api-status'} role="status">
            <span>{starting ? 'Connecting…' : connected ? 'API connected' : 'API unavailable'}</span>
          </p>
          <ThemeToggle />
        </div>
      </header>

      <div className="app-layout">
        {sidebarOpen && (
          <button className="sidebar-scrim" type="button" aria-label="Close chat sidebar" onClick={() => {
            setOpenMenuId(null)
            setSidebarOpen(false)
          }} />
        )}
        <aside id="chat-sidebar" className="sidebar" hidden={!sidebarOpen}>
          <button id="sidebar-new-chat" className="primary sidebar-new" type="button" onClick={newChat} disabled={starting || creating}>
            <Plus size={17} aria-hidden="true" />
            {creating ? 'Creating…' : 'New chat'}
          </button>
          <nav className="chat-navigation" aria-label="Chats">
            <h2>Chats</h2>
            {chats.map(chat => {
              const menuOpen = chat.id === openMenuId
              const actionId = 'chat-actions-' + chat.id
              const menuId = 'chat-menu-' + chat.id
              return (
                <div className="chat-item" key={chat.id} onKeyDown={event => {
                  if (event.key === 'Escape' && menuOpen) {
                    event.preventDefault()
                    setOpenMenuId(null)
                    document.getElementById(actionId)?.focus()
                  }
                }}>
                  <div className="chat-row">
                    <button
                      className="chat-select"
                      id={'chat-select-' + chat.id}
                      type="button"
                      title={chat.title}
                      aria-current={chat.id === activeId ? 'page' : undefined}
                      onClick={() => openChat(chat.id)}
                    >
                      <MessageSquare size={16} strokeWidth={1.75} aria-hidden="true" />
                      <span>{chat.title}</span>
                    </button>
                    <button
                      className="icon-button chat-actions-toggle"
                      id={actionId}
                      type="button"
                      aria-label={'Chat actions for ' + chat.title}
                      aria-controls={menuId}
                      aria-expanded={menuOpen}
                      disabled={starting || creating}
                      onClick={() => setOpenMenuId(menuOpen ? null : chat.id)}
                    >
                      <Ellipsis size={19} aria-hidden="true" />
                    </button>
                  </div>
                  <div className="chat-actions-menu" id={menuId} hidden={!menuOpen}>
                    <button className="subtle-button delete-menu-action" type="button" onClick={() => {
                      setOpenMenuId(null)
                      setDeleteTarget(chat)
                    }}>
                      <Trash2 size={16} aria-hidden="true" />
                      Delete chat
                    </button>
                  </div>
                </div>
              )
            })}
          </nav>
          <p className="sidebar-note">Chats are kept until the server restarts.</p>
        </aside>

        <main className="chat-main">
          {startupError && (
            <div className="startup-error" role="alert">
              <span>{startupError}</span>
              <button className="subtle-button" type="button" onClick={() => {
                setStartupError('')
                setStarting(true)
                setAttempt(value => value + 1)
              }}>
                Retry connection
              </button>
            </div>
          )}
          {activeId && <ChatView key={activeId} id={activeId} onUpdate={updateSummary} />}
          {starting && !activeId && <p className="chat-loading" role="status">Loading chats…</p>}
          {!starting && connected && !activeId && (
            <div className="empty-chat empty-chat-list">
              <div className="empty-icon"><FolderCheck size={34} strokeWidth={1.4} aria-hidden="true" /></div>
              <h2>No chats yet</h2>
              <p>Start a new chat to ask about a PDF or photo.</p>
              <button className="primary" type="button" onClick={newChat} disabled={creating}>
                <Plus size={17} aria-hidden="true" />
                {creating ? 'Creating…' : 'New chat'}
              </button>
            </div>
          )}
        </main>
      </div>
      {deleteTarget && <DeleteChatDialog chat={deleteTarget} onConfirm={deleteChat} onClose={cancelDelete} />}
    </div>
  )
}

export default App
