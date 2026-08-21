import { useParams } from "react-router-dom"

import DashboardPage from "./Dashboard"
import CustomerOrdersPage from "./CustomerOrders"
import CustomersPage from "./Customers"
import DeliveryLocationsPage from "./DeliveryLocations"
import MyOrdersPage from "./MyOrders"
import PaymentsPage from "./Payments"
import ProductCatalogPage from "./ProductCatalog"
import QuotationQueuePage from "./QuotationQueue"
import QuotationRequestsPage from "./QuotationRequests"
import PurchaseOrdersPage from "./PurchaseOrders"

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

    case "quotation-queue":
      return <QuotationQueuePage />

    case "quotation-requests":
      return <QuotationRequestsPage />

    default:
      return (
        <h1>
          Page Not Found
        </h1>
      )
  }
}