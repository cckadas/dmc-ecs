import { useParams } from "react-router-dom"

import DashboardPage from "./Dashboard"
import CustomerOrdersPage from "./CustomerOrders"
import CustomersPage from "./Customers"
import DeliveryLocationsPage from "./DeliveryLocations"
import MyOrdersPage from "./MyOrders"
import PaymentsPage from "./Payments"
import ProductCatalogPage from "./ProductCatalog"
import ProFormaInvoicePage from "./ProFormaInvoice"
import QuotationRequestsPage from "./QuotationRequests"
import PurchaseOrdersPage from "./PurchaseOrders"
import SuppliersPage from "./Suppliers"
import SupplierPerformancePage from "./SupplierPerformance"


export default function PageRouter(){

  const { page } = useParams()

  switch(page){
    case "dashboard":
      return <DashboardPage />

    case "customer-orders":
      return <CustomerOrdersPage />

    case "customers":
      return <CustomersPage />

    case "delivery-locations":
      return <DeliveryLocationsPage />

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