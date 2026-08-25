"use client";

import { ArrowLeft, Bot, Cpu, IdCard, Sparkles, Users } from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useState } from "react";
import UsersTab from "./UsersTab";
import RolesTab from "./RolesTab";
import AgentsTab from "./AgentsTab";
import ModelsTab from "./ModelsTab";
import SkillsTab from "./SkillsTab";

const TABS = [
  { id: "users", label: "用户管理", icon: Users, Component: UsersTab },
  { id: "roles", label: "角色管理", icon: IdCard, Component: RolesTab },
  { id: "agents", label: "Agent 管理", icon: Bot, Component: AgentsTab },
  { id: "models", label: "模型配置", icon: Cpu, Component: ModelsTab },
  { id: "skills", label: "Skills 管理", icon: Sparkles, Component: SkillsTab },
] as const;

export default function AdminConsole() {
  const [tab, setTab] = useState<(typeof TABS)[number]["id"]>("users");

  return (
    <div className="min-h-dvh bg-background">
      <div className="mx-auto w-[min(1100px,calc(100%-48px))] py-9">
        <header className="mb-6 flex items-start justify-between gap-4">
          <div className="flex items-start gap-3">
            <a href="/chat" className="mt-0.5 inline-flex h-8 w-8 items-center justify-center rounded-md border border-input bg-card text-muted-foreground transition-colors hover:bg-accent" aria-label="返回聊天" title="返回聊天">
              <ArrowLeft className="h-4 w-4" />
            </a>
            <div>
              <h1 className="text-2xl font-semibold tracking-tight">后台管理</h1>
              <p className="mt-1 text-xs text-muted-foreground">用户、角色、Agent、模型与 Skills 的集中配置。</p>
            </div>
          </div>
          <span className="inline-flex items-center gap-1.5 rounded-full bg-secondary px-2.5 py-1 text-[10px] font-semibold text-secondary-foreground">
            仅限管理员
          </span>
        </header>

        <Tabs value={tab} onValueChange={(v) => setTab(v as typeof tab)}>
          <TabsList className="flex h-auto w-full flex-wrap justify-start">
            {TABS.map((t) => {
              const Icon = t.icon;
              return (
                <TabsTrigger key={t.id} value={t.id}>
                  <Icon className="h-4 w-4" />
                  {t.label}
                </TabsTrigger>
              );
            })}
          </TabsList>
          {TABS.map((t) => (
            <TabsContent key={t.id} value={t.id}>
              <t.Component />
            </TabsContent>
          ))}
        </Tabs>
      </div>
    </div>
  );
}
