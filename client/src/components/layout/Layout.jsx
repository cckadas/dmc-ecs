import { useState } from 'react'
import { useAuth } from '../../context/AuthContext'

import Sidebar from './Sidebar'
import Topbar from './Topbar'
import Chatbot from './Chatbot'

export default function Layout({ children }) {
  const { profile } = useAuth()

  const [collapsed, setCollapsed] = useState(false)
  const isCustomer = profile?.role === 'customer'

  return (
    <div className="min-h-screen bg-[#EEF3EF]">

      <Sidebar collapsed={collapsed} />
      <Topbar collapsed={collapsed} onToggleSidebar={() => setCollapsed(!collapsed)}/>

      <main className={`pt-16 transition-all duration-300 ${ collapsed ? 'ml-24' : 'ml-72' }`}>
        <div className="min-h-[calc(100vh-4rem)] p-6 lg:p-8">
          {children}
        </div>
      </main>

      {isCustomer && (
        <Chatbot />
      )}

    </div>
  )
}