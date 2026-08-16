import { useAuth } from "../context/AuthContext"


export default function DashboardPage() {
  const { profile } = useAuth()
  const role = profile?.role

  const dashboardContent = {
    admin: {
      title: "Admin Dashboard",
      description: "Manage users, system settings, reports, and overall DMC ECS operations.",
    },

    warehouse: {
      title: "Warehouse Dashboard",
      description: "Monitor inventory, receiving, staging, locations, and warehouse activities.",
    },

    procurement: {
      title: "Procurement Dashboard",
      description: "Manage suppliers, purchase orders, and procurement operations.",
    },

    sales: {
      title: "Sales Dashboard",
      description: "Manage customer orders, quotations, and sales activities.",
    },
  }


  const content = dashboardContent[role] || {
    title: "Dashboard",
    description: "Welcome to DMC Export Consolidation System.",
  }
  

  return (
    <div className="flex min-h-[calc(100vh-4rem)] items-center justify-center">
      <div className="text-center">
        <h1 className="text-4xl font-bold text-gray-800">
          {content.title}
        </h1>

        <p className="mt-3 text-gray-500">
          {content.description}
        </p>

        <p className="mt-5 text-sm text-green-700 font-semibold uppercase">
          Role: {role}
        </p>
      </div>
    </div>
  )
}