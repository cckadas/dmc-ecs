import { useParams } from "react-router-dom"

import BillingsPage from "./Billings"
import ComplianceLabelCustomerPage from "./ComplianceLabelCustomer"
import ComplianceLabelSalesPage from "./ComplianceLabelSales"
import ComplianceLabelWarehousePage from "./ComplianceLabelWarehouse"
import CustomersPage from "./Customers"
import CustomerOrdersPage from "./CustomerOrders"
import DashboardPage from "./Dashboard"
import DeliveryLocationsPage from "./DeliveryLocations"
import DocumentsPage from "./Documents"
import ExecutiveDashboardPage from "./ExecutiveDashboard"
import MyOrdersPage from "./MyOrders"
import PaymentsPage from "./Payments"
import ProductCatalogPage from "./ProductCatalog"
import ProFormaInvoicePage from "./ProFormaInvoice"
import PurchaseOrdersPage from "./PurchaseOrders"
import QuotationRequestsPage from "./QuotationRequests"
import ReceivingPage from "./Receiving"
import SettingsPage from "./Settings"
import StagingTrackerPage from "./StagingTracker"
import SuppliersPage from "./Suppliers"
import SupplierPerformancePage from "./SupplierPerformance"
import WarehouseHoldingsPage from "./WarehouseHoldings"
import WarehouseLocationPage from "./WarehouseLocations"


export default function PageRouter(){

  const { page } = useParams()

  switch(page){

    case "billings":
      return <BillingsPage />

    case "compliance-label-customer":
      return <ComplianceLabelCustomerPage />

    case "compliance-label-sales":
      return <ComplianceLabelSalesPage />

    case "compliance-label-warehouse":
      return <ComplianceLabelWarehousePage />

    case "customers":
      return <CustomersPage />

    case "customer-orders":
      return <CustomerOrdersPage />

    case "dashboard":
      return <DashboardPage />

    case "delivery-locations":
      return <DeliveryLocationsPage />

    case "documents":
      return <DocumentsPage />

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

    case "receiving":
      return <ReceivingPage />

    case "settings":
      return <SettingsPage />

    case "staging-tracker":
      return <StagingTrackerPage />

    case "suppliers":
      return <SuppliersPage />

    case "supplier-performance":
      return <SupplierPerformancePage />

    case "warehouse-holdings":
      return <WarehouseHoldingsPage />

    case "warehouse-location":
      return <WarehouseLocationPage />

    default:
      return (
        <h1>
          Page Not Found
        </h1>
      )
  }
}