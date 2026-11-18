import React from "react"
import ReactDOM from "react-dom/client"

import "./index.css"
import App from "./App.jsx"

import { AuthProvider } from "./context/AuthContext"
import { ToastProvider } from "./context/ToastContext.jsx"
import { keepNumbersFromScrolling } from "./utils/noScrollNumbers"


// The mouse wheel never changes a number box: numbers are typed.
keepNumbersFromScrolling()


ReactDOM.createRoot(
  document.getElementById("root")
).render(
  <React.StrictMode>
    <AuthProvider>
      <ToastProvider>
        <App />
      </ToastProvider>
    </AuthProvider>
  </React.StrictMode>
)