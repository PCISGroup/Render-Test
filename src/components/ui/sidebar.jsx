import React, { createContext, useContext, useState } from "react";
import { cn } from "../../lib/utils";

const SidebarContext = createContext({});

export function SidebarProvider({ children, ...props }) {
  const [open, setOpen] = useState(false);
  
  return (
    <SidebarContext.Provider value={{ open, setOpen }} {...props}>
      {children}
    </SidebarContext.Provider>
  );
}

export function useSidebar() {
  const context = useContext(SidebarContext);
  if (!context) {
    throw new Error("useSidebar must be used within a SidebarProvider");
  }
  return context;
}

export function Sidebar({ className, ...props }) {
  return (
    <div
      className={cn(
        "flex h-full flex-col w-64 bg-white transition-all duration-300",
        className
      )}
      {...props}
    />
  );
}

export function SidebarHeader({ className, ...props }) {
  return (
    <div
      className={cn("flex items-center justify-center p-4", className)}
      {...props}
    />
  );
}

export function SidebarContent({ className, ...props }) {
  return (
    <div
      className={cn("flex-1 overflow-auto py-2", className)}
      {...props}
    />
  );
}

export function SidebarGroup({ className, ...props }) {
  return (
    <div
      className={cn("px-3 py-2", className)}
      {...props}
    />
  );
}

export function SidebarGroupLabel({ className, ...props }) {
  return (
    <div
      className={cn(
        "mb-2 px-2 text-xs font-semibold uppercase tracking-wider",
        className
      )}
      {...props}
    />
  );
}

export function SidebarGroupContent({ className, ...props }) {
  return (
    <div className={cn("space-y-1", className)} {...props} />
  );
}

export function SidebarMenu({ className, ...props }) {
  return (
    <ul className={cn("flex flex-col space-y-1", className)} {...props} />
  );
}

export function SidebarMenuItem({ className, ...props }) {
  return (
    <li className={cn("", className)} {...props} />
  );
}

export function SidebarMenuButton({ asChild = false, className, ...props }) {
  const Comp = asChild ? "span" : "button";
  
  return (
    <Comp
      className={cn(
        "flex w-full items-center rounded-md px-3 py-2 text-sm font-medium transition-colors hover:bg-gray-100 focus:outline-none focus:bg-gray-100",
        className
      )}
      {...props}
    />
  );
}

export function SidebarTrigger({ className, ...props }) {
  const { setOpen } = useSidebar();
  
  return (
    <button
      className={cn(
        "inline-flex items-center justify-center rounded-md text-sm font-medium transition-colors focus:outline-none",
        className
      )}
      onClick={() => setOpen(true)}
      {...props}
    >
      <svg
        width="15"
        height="15"
        viewBox="0 0 15 15"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        className="h-5 w-5"
      >
        <path
          d="M1.5 3C1.22386 3 1 3.22386 1 3.5C1 3.77614 1.22386 4 1.5 4H13.5C13.7761 4 14 3.77614 14 3.5C14 3.22386 13.7761 3 13.5 3H1.5ZM1 7.5C1 7.22386 1.22386 7 1.5 7H13.5C13.7761 7 14 7.22386 14 7.5C14 7.77614 13.7761 8 13.5 8H1.5C1.22386 8 1 7.77614 1 7.5ZM1 11.5C1 11.2239 1.22386 11 1.5 11H13.5C13.7761 11 14 11.2239 14 11.5C14 11.7761 13.7761 12 13.5 12H1.5C1.22386 12 1 11.7761 1 11.5Z"
          fill="currentColor"
          fillRule="evenodd"
          clipRule="evenodd"
        ></path>
      </svg>
    </button>
  );
}