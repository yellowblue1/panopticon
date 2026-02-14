import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

interface TabItem {
  id: string;
  label: string;
  icon?: ReactNode;
  disabled?: boolean;
}

interface SessionTabsProps {
  tabs: TabItem[];
  activeTab: string;
  onTabChange: (tabId: string) => void;
}

export function SessionTabs({ tabs, activeTab, onTabChange }: SessionTabsProps) {
  return (
    <div className="session-tabs">
      {tabs.map((tab) => (
        <button
          key={tab.id}
          type="button"
          className={cn("tab-button", activeTab === tab.id && "active")}
          onClick={() => onTabChange(tab.id)}
          disabled={tab.disabled}
        >
          {tab.icon}
          <span>{tab.label}</span>
        </button>
      ))}
    </div>
  );
}
