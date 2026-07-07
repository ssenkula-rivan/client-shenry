import React from "react";
import { createRoot } from "react-dom/client";
import "../src/index.css";
import DesignerAgentSystem from "../designer-agent-system.jsx";

const root = createRoot(document.getElementById("root"));
root.render(
  <React.StrictMode>
    <DesignerAgentSystem />
  </React.StrictMode>
);

