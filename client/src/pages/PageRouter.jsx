import { useParams } from "react-router-dom"

import DashboardPage from "./Dashboard"
import CustomerOrdersPage from "./CustomerOrders"
import CustomersPage from "./Customers"
import ProductCatalogPage from "./ProductCatalog"
import DeliveryLocationsPage from "./DeliveryLocations"
import QuotationRequestsPage from "./QuotationRequests"
import QuotationQueuePage from "./QuotationQueue"

export default function PageRouter(){

  const { page } = useParams()

  switch(page){
    case "dashboard":
      return <DashboardPage />

    case "customer-orders":
      return <CustomerOrdersPage />

    case "customers":
      return <CustomersPage />

    case "product-catalog":
      return <ProductCatalogPage />

    case "delivery-locations":
      return <DeliveryLocationsPage />

    case "quotation-requests":
      return <QuotationRequestsPage />

    case "quotation-queue":
      return <QuotationQueuePage />

    default:
      return (
        <h1>
          Page Not Found
        </h1>
      )
  }
}