export type PersonalWorkspaceRibbonTab =
  | "home"
  | "insert"
  | "layout"
  | "review"
  | "view";

export type PersonalWorkspaceViewState = {
  ribbonTab: PersonalWorkspaceRibbonTab;
  zoomPercent: number;
  focusMode: boolean;
  sidebarCollapsed: boolean;
};

export type PersonalTreePage = {
  id: string;
  title: string | null;
  section_id: string | null;
  owner_id: string;
  share_mode: string | null;
  updated_at: string | null;
  sort_order: number | null;
};

export type PersonalTreeSection = {
  id: string;
  title: string;
  owner_id: string;
  sort_order: number;
  created_at: string;
  pages: PersonalTreePage[];
};

export type PersonalWorkspaceTree = {
  sections: PersonalTreeSection[];
  generalPages: PersonalTreePage[];
  pageSortOrderColumnMissing: boolean;
};

export type PersonalPageUserState = {
  page_id: string;
  is_favorite: boolean;
  last_opened_at: string | null;
  zoom_percent: number | null;
  last_ribbon_tab: PersonalWorkspaceRibbonTab | null;
  sidebar_collapsed: boolean | null;
  focus_mode: boolean | null;
  updated_at: string | null;
};
