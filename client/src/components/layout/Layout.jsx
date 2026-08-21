import { useState } from 'react'

import Sidebar from './Sidebar'
import Topbar from './Topbar'

export default function Layout({ children }) {
  const [collapsed, setCollapsed] = useState(false)

  return (
    <div className="min-h-screen bg-[#EEF3EF]">

      <Sidebar collapsed={collapsed} />
      <Topbar collapsed={collapsed} onToggleSidebar={() => setCollapsed(!collapsed)}/>

      <main className={`pt-16 transition-all duration-300 ${ collapsed ? 'ml-24' : 'ml-72' }`}>
        <div className="min-h-[calc(100vh-4rem)] p-6 lg:p-8">
          {children}
        </div>
      </main>

    </div>
  )
}