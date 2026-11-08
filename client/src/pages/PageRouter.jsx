import { lazy, Suspense } from "react"
import { useParams } from "react-router-dom"

import AccountsPage from "./Accounts"
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
import PricingCreditPage from "./PricingCredit"
import PredictionSettingsPage from "./PredictionSettings"
import PurchaseOrdersPage from "./PurchaseOrders"
import QuotationRequestsPage from "./QuotationRequests"
import ReceivingPage from "./Receiving"
import SettingsPage from "./Settings"
import StagingTrackerPage from "./StagingTracker"
import SupplierPriceListsPage from "./SupplierPriceLists"
import SuppliersPage from "./Suppliers"
import WarehouseHoldingsPage from "./WarehouseHoldings"
import WarehouseLocationPage from "./WarehouseLocations"

// The pages with charts load the chart library (Recharts) only when opened,
// so no one else downloads it.
const PredictiveAnalyticsPage = lazy(() => import("./PredictiveAnalytics"))
const SupplierPerformancePage = lazy(() => import("./SupplierPerformance"))

const withCharts = (page) => (
  <Suspense fallback={<p className="text-sm text-gray-500">Loading…</p>}>
    {page}
  </Suspense>
)


export default function PageRouter(){

  const { page } = useParams()

  switch(page){
    
    case "accounts":
      return <AccountsPage />

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

    case "pricing-credit":
      return <PricingCreditPage />

    case "prediction-settings":
      return <PredictionSettingsPage />

    case "predictive-analytics":
      return withCharts(<PredictiveAnalyticsPage />)

    case "price-lists":
      return <SupplierPriceListsPage />

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
      return withCharts(<SupplierPerformancePage />)

    case "warehouse-holdings":
      return <WarehouseHoldingsPage />

    case "warehouse-locations":
      return <WarehouseLocationPage />

    default:
      return (
        <h1>
          Page Not Found
        </h1>
      )
  }
}