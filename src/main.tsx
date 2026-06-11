/**
 * 应用入口文件。
 * 使用 React 18 的 createRoot API 将根组件挂载到 DOM，
 * 同时导入全局样式表。
 */
import React from "react";
import ReactDOM from "react-dom/client";
import { App } from "./App";
import "./styles.css";

// 挂载 React 应用到 #root 容器
ReactDOM.createRoot(document.getElementById("root")!).render(<App />);
