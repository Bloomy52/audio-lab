import { useState } from "react";
import { version } from "../package.json";
import { Header } from "./components/Header";
import { LoopStudio } from "./components/LoopStudio";
import { BatchConverter } from "./components/BatchConverter";
export function App() {
  const [activeTab, setActiveTab] = useState<"studio" | "batch">("studio");
  return (
    <div className="app">
      <Header activeTab={activeTab} onTabChange={setActiveTab} />
      <main>
        <div hidden={activeTab !== "studio"}>
          <LoopStudio active={activeTab === "studio"} />
        </div>
        <div hidden={activeTab !== "batch"}>
          <BatchConverter />
        </div>
      </main>
      <footer>
        Audio Lab v{version} · Files stay on your device · Download results before closing
        or refreshing this page
      </footer>
    </div>
  );
}
export default App;
