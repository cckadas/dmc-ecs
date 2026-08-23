import { useParams } from "react-router-dom"

import CustomersPage from "./Customers"
import CustomerOrdersPage from "./CustomerOrders"
import DashboardPage from "./Dashboard"
import DeliveryLocationsPage from "./DeliveryLocations"
import ExecutiveDashboardPage from "./ExecutiveDashboard"
import MyOrdersPage from "./MyOrders"
import PaymentsPage from "./Payments"
import ProductCatalogPage from "./ProductCatalog"
import ProFormaInvoicePage from "./ProFormaInvoice"
import PurchaseOrdersPage from "./PurchaseOrders"
import QuotationRequestsPage from "./QuotationRequests"
import SuppliersPage from "./Suppliers"
import SupplierPerformancePage from "./SupplierPerformance"


export default function PageRouter(){

  const { page } = useParams()

  switch(page){
    case "customers":
      return <CustomersPage />

    case "customer-orders":
      return <CustomerOrdersPage />

    case "dashboard":
      return <DashboardPage />

    case "delivery-locations":
      return <DeliveryLocationsPage />

    case "executive-dashboard":
      return <ExecutiveDashboardPage />

    case "my-orders":
      return <MyOrdersPage />

    case "payments":
      return <PaymentsPage />

    case "product-catalog":
      return <ProductCatalogPage />
    
    case "purchase-orders":
      return <PurchaseOrdersPage />

    case "pfi-builder":
      return <ProFormaInvoicePage />

    case "quotation-requests":
      return <QuotationRequestsPage />

    case "suppliers":
      return <SuppliersPage />

    case "supplier-performance":
      return <SupplierPerformancePage />

    default:
      return (
        <h1>
          Page Not Found
        </h1>
      )
  }
}