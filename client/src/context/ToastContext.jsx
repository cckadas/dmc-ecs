import { createContext, useContext, useState } from "react";

const ToastContext = createContext();

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);

  function addToast(message, type = "success") {
    const id = Date.now();

    setToasts((prev) => [
      ...prev,
      { id, message, type }
    ]);

    setTimeout(() => {
      setToasts((prev) => prev.filter((toast) => toast.id !== id));
    }, 3000);
  }

  const toast = {
    success: (msg) => addToast(msg, "success"),
    error: (msg) => addToast(msg, "error"),
    info: (msg) => addToast(msg, "info"),
  };

  return (
    <ToastContext.Provider value={{ toast }}>
      {children}

      <div className="fixed bottom-5 right-5 z-50 space-y-3">
        {toasts.map((item) => (
          <div
            key={item.id}
            className={`
              px-5 py-3 rounded-lg shadow-lg text-white
              ${
                item.type === "success"
                  ? "bg-green-600"
                  : item.type === "error"
                  ? "bg-red-600"
                  : "bg-blue-600"
              }
            `}
          >
            {item.message}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  return useContext(ToastContext);
}