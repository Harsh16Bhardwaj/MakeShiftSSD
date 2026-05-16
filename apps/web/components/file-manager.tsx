"use client";

import { ChangeEvent, FormEvent, KeyboardEvent, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowDownAZ,
  ArrowLeft,
  ArrowRight,
  Check,
  Clipboard,
  Copy,
  Download,
  Eye,
  File,
  FileArchive,
  FileAudio,
  FileCode,
  FileImage,
  FileText,
  FileVideo,
  Folder,
  FolderPlus,
  Grid3X3,
  ImagePlus,
  HardDrive,
  Image as ImageIcon,
  Info,
  Keyboard,
  List,
  LogOut,
  Moon,
  MoreVertical,
  Pencil,
  RefreshCcw,
  Scissors,
  Sun,
  TableProperties,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import type { ApiError, DirectoryListing, FileItem, PreviewInfo } from "@/lib/types";

type BusyState = "idle" | "loading" | "mutating";
type ThemeMode = "light" | "dark";
type SortMode = "name" | "type" | "modified" | "size";
type ViewMode = "grid" | "compact" | "details";
type SmartFilter = "all" | "images" | "videos" | "audio" | "documents";
type ClipboardState = { mode: "copy" | "cut"; items: FileItem[] } | null;
type UploadState = { id: string; name: string; progress: number; status: "queued" | "uploading" | "done" | "error"; error?: string };
type DeleteDialogState = { items: FileItem[] } | null;
type MenuState =
  | { type: "item"; item: FileItem; x: number; y: number }
  | { type: "folder"; x: number; y: number }
  | null;

type PreviewState = {
  item: FileItem;
  info: PreviewInfo;
  text?: string;
  error?: string;
};

export function FileManager() {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const backgroundInputRef = useRef<HTMLInputElement | null>(null);
  const uploadTargetPathRef = useRef("");
  const [currentPath, setCurrentPath] = useState("");
  const [history, setHistory] = useState<string[]>([""]);
  const [historyIndex, setHistoryIndex] = useState(0);
  const [listing, setListing] = useState<DirectoryListing | null>(null);
  const [busyState, setBusyState] = useState<BusyState>("loading");
  const [error, setError] = useState("");
  const [folderName, setFolderName] = useState("");
  const [preview, setPreview] = useState<PreviewState | null>(null);
  const [isPreviewLoading, setIsPreviewLoading] = useState(false);
  const [isWindowOpen, setIsWindowOpen] = useState(false);
  const [isWindowMinimized, setIsWindowMinimized] = useState(false);
  const [theme, setTheme] = useState<ThemeMode>("dark");
  const [menu, setMenu] = useState<MenuState>(null);
  const [sortMode, setSortMode] = useState<SortMode>("name");
  const [viewMode, setViewMode] = useState<ViewMode>("grid");
  const [smartFilter, setSmartFilter] = useState<SmartFilter>("all");
  const [selectedPaths, setSelectedPaths] = useState<Set<string>>(new Set());
  const [clipboard, setClipboard] = useState<ClipboardState>(null);
  const [uploadQueue, setUploadQueue] = useState<UploadState[]>([]);
  const [toast, setToast] = useState("");
  const [showShortcuts, setShowShortcuts] = useState(false);
  const [showBackgrounds, setShowBackgrounds] = useState(false);
  const [backgroundImage, setBackgroundImage] = useState("");
  const [deleteDialog, setDeleteDialog] = useState<DeleteDialogState>(null);

  useEffect(() => {
    const savedTheme = window.localStorage.getItem("personalcloud-theme");
    if (savedTheme === "light" || savedTheme === "dark") {
      setTheme(savedTheme);
    }
    const savedBackground = window.localStorage.getItem("personalcloud-background-image");
    if (savedBackground) {
      setBackgroundImage(savedBackground);
    }
  }, []);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    window.localStorage.setItem("personalcloud-theme", theme);
  }, [theme]);

  useEffect(() => {
    if (backgroundImage) {
      window.localStorage.setItem("personalcloud-background-image", backgroundImage);
    } else {
      window.localStorage.removeItem("personalcloud-background-image");
    }
  }, [backgroundImage]);

  useEffect(() => {
    if (!isWindowOpen) return;
    void loadDirectory(currentPath);
  }, [currentPath, isWindowOpen]);

  useEffect(() => {
    function closeMenu() {
      setMenu(null);
    }

    window.addEventListener("click", closeMenu);
    window.addEventListener("resize", closeMenu);
    return () => {
      window.removeEventListener("click", closeMenu);
      window.removeEventListener("resize", closeMenu);
    };
  }, []);

  const breadcrumbs = useMemo(() => buildBreadcrumbs(currentPath), [currentPath]);
  const filteredItems = useMemo(() => filterItems(listing?.items ?? [], smartFilter), [listing?.items, smartFilter]);
  const sortedItems = useMemo(() => sortItems(filteredItems, sortMode), [filteredItems, sortMode]);
  const selectedItems = useMemo(
    () => sortedItems.filter((item) => selectedPaths.has(item.path)),
    [selectedPaths, sortedItems],
  );
  const canGoBack = historyIndex > 0;
  const canGoForward = historyIndex < history.length - 1;

  async function loadDirectory(path: string) {
    setBusyState("loading");
    setError("");

    const response = await fetch(`/api/storage/list?path=${encodeURIComponent(path)}`, {
      cache: "no-store",
    });

    if (!response.ok) {
      setError(await readError(response));
      setBusyState("idle");
      return;
    }

    const data = (await response.json()) as DirectoryListing;
    setListing(data);
    setBusyState("idle");
  }

  function openRoot() {
    setIsWindowOpen(true);
    setIsWindowMinimized(false);
    navigateTo("");
  }

  function navigateTo(path: string) {
    setCurrentPath(path);
    setPreview(null);
    setMenu(null);
    setSmartFilter("all");
    clearSelection();
    setHistory((previous) => {
      const next = previous.slice(0, historyIndex + 1);
      if (next[next.length - 1] !== path) next.push(path);
      setHistoryIndex(next.length - 1);
      return next;
    });
  }

  function goBack() {
    if (!canGoBack) return;
    const nextIndex = historyIndex - 1;
    setHistoryIndex(nextIndex);
    setCurrentPath(history[nextIndex]);
    setMenu(null);
    clearSelection();
  }

  function goForward() {
    if (!canGoForward) return;
    const nextIndex = historyIndex + 1;
    setHistoryIndex(nextIndex);
    setCurrentPath(history[nextIndex]);
    setMenu(null);
    clearSelection();
  }

  function triggerUpload(parentPath: string) {
    uploadTargetPathRef.current = parentPath;
    fileInputRef.current?.click();
  }

  async function handleLogout() {
    await fetch("/api/session/logout", { method: "POST" });
    window.location.href = "/login";
  }

  async function createFolder(event?: FormEvent<HTMLFormElement>) {
    event?.preventDefault();
    const name = folderName.trim();
    if (!name) return;

    await mutate(async () => {
      const response = await fetch("/api/storage/folders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ parent_path: currentPath, name }),
      });

      if (!response.ok) throw new Error(await readError(response));
      setFolderName("");
    });
  }

  async function createFolderWithPrompt() {
    const name = window.prompt("New folder name")?.trim();
    if (!name) return;

    await mutate(async () => {
      const response = await fetch("/api/storage/folders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ parent_path: currentPath, name }),
      });

      if (!response.ok) throw new Error(await readError(response));
      setFolderName("");
    });
  }

  async function uploadFiles(event: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files ?? []);
    if (!files.length) return;

    const parentPath = uploadTargetPathRef.current;
    const uploadEntries = files.map((file) => ({
      file,
      id: crypto.randomUUID(),
    }));
    const nextQueue = uploadEntries.map(({ file, id }) => ({
      id,
      name: file.name,
      progress: 0,
      status: "queued" as const,
    }));
    setUploadQueue(nextQueue);

    for (const { file, id } of uploadEntries) {
      setUploadQueue((previous) => updateUpload(previous, id, { progress: 12, status: "uploading" }));
      const formData = new FormData();
      formData.append("parent_path", parentPath);
      formData.append("file", file);

      const response = await fetch("/api/storage/upload", {
        method: "POST",
        body: formData,
      });

      if (!response.ok) {
        const uploadError = await readError(response);
        setUploadQueue((previous) => updateUpload(previous, id, { progress: 100, status: "error", error: uploadError }));
        continue;
      }

      setUploadQueue((previous) => updateUpload(previous, id, { progress: 100, status: "done" }));
    }

    if (fileInputRef.current) fileInputRef.current.value = "";
    uploadTargetPathRef.current = currentPath;
    await loadDirectory(currentPath);
  }

  async function renameItem(item: FileItem) {
    const newName = window.prompt("Rename item", item.name)?.trim();
    if (!newName || newName === item.name) return;

    await mutate(async () => {
      const response = await fetch("/api/storage/rename", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path: item.path, new_name: newName }),
      });

      if (!response.ok) throw new Error(await readError(response));
      clearSelection();
    });
  }

  function requestDelete(items: FileItem[]) {
    if (!items.length) return;
    setDeleteDialog({ items });
    setMenu(null);
  }

  async function confirmDeleteItems() {
    const items = deleteDialog?.items ?? [];
    if (!items.length) return;
    await mutate(async () => {
      for (const item of items) {
        const response = await fetch(`/api/storage/delete?path=${encodeURIComponent(item.path)}`, {
          method: "DELETE",
        });

        if (!response.ok) throw new Error(await readError(response));
      }
      clearSelection();
      setDeleteDialog(null);
    });
  }

  function handleBackgroundFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === "string") {
        setBackgroundImage(reader.result);
      }
    };
    reader.readAsDataURL(file);
    if (backgroundInputRef.current) backgroundInputRef.current.value = "";
  }

  async function transferClipboard() {
    if (!clipboard?.items.length) return;
    const response = await fetch(`/api/storage/${clipboard.mode === "cut" ? "move" : "copy"}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        source_paths: clipboard.items.map((item) => item.path),
        destination_parent_path: currentPath,
      }),
    });

    if (!response.ok) {
      setError(await readError(response));
      return;
    }

    showToast(`${clipboard.mode === "cut" ? "Moved" : "Copied"} ${clipboard.items.length} item(s)`);
    if (clipboard.mode === "cut") setClipboard(null);
    await loadDirectory(currentPath);
  }

  async function previewItem(item: FileItem) {
    if (item.kind !== "file") return;
    setIsPreviewLoading(true);
    setPreview(null);
    setSelectedPaths(new Set([item.path]));

    const infoResponse = await fetch(`/api/storage/preview-info?path=${encodeURIComponent(item.path)}`, {
      cache: "no-store",
    });

    if (!infoResponse.ok) {
      setPreview({
        item,
        info: unsupportedPreviewInfo(item, await readError(infoResponse)),
      });
      setIsPreviewLoading(false);
      return;
    }

    const info = (await infoResponse.json()) as PreviewInfo;
    setPreview({ item, info });

    if (!info.supported || info.kind !== "text") {
      setIsPreviewLoading(false);
      return;
    }

    const response = await fetch(`/api/storage/preview?path=${encodeURIComponent(item.path)}`, {
      cache: "no-store",
    });

    if (!response.ok) {
      setPreview({ item, info, error: await readError(response) });
      setIsPreviewLoading(false);
      return;
    }

    setPreview({ item, info, text: await response.text() });
    setIsPreviewLoading(false);
  }

  async function copyPath(path: string) {
    const displayPath = path || "Root";
    try {
      await navigator.clipboard.writeText(displayPath);
      showToast("Path copied");
    } catch {
      showToast(displayPath);
    }
  }

  async function mutate(action: () => Promise<void>) {
    setBusyState("mutating");
    setError("");
    setMenu(null);

    try {
      await action();
      await loadDirectory(currentPath);
      setPreview(null);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Operation failed");
      setBusyState("idle");
    }
  }

  function setClipboardFromSelection(mode: "copy" | "cut", fallback?: FileItem) {
    const items = selectedItems.length ? selectedItems : fallback ? [fallback] : [];
    if (!items.length) return;
    setClipboard({ mode, items });
    showToast(`${mode === "cut" ? "Cut" : "Copied"} ${items.length} item(s)`);
  }

  function selectItem(item: FileItem, additive: boolean) {
    setSelectedPaths((previous) => {
      if (!additive) return new Set([item.path]);
      const next = new Set(previous);
      if (next.has(item.path)) next.delete(item.path);
      else next.add(item.path);
      return next;
    });
  }

  function clearSelection() {
    setSelectedPaths(new Set());
  }

  function selectAll() {
    setSelectedPaths(new Set(sortedItems.map((item) => item.path)));
  }

  function showToast(message: string) {
    setToast(message);
    window.setTimeout(() => setToast(""), 1800);
  }

  function selectedOrItem(item: FileItem) {
    return selectedPaths.has(item.path) && selectedItems.length ? selectedItems : [item];
  }

  function handleExplorerKeyDown(event: KeyboardEvent<HTMLElement>) {
    const target = event.target as HTMLElement;
    if (["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName)) return;

    const primary = selectedItems[0];
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "a") {
      event.preventDefault();
      selectAll();
    }
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "c") {
      event.preventDefault();
      setClipboardFromSelection("copy");
    }
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "x") {
      event.preventDefault();
      setClipboardFromSelection("cut");
    }
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "v") {
      event.preventDefault();
      void transferClipboard();
    }
    if (event.key === "Delete" || event.key === "Backspace") {
      event.preventDefault();
      requestDelete(selectedItems);
    }
    if (event.key === "Enter" && primary) {
      event.preventDefault();
      if (primary.kind === "directory") navigateTo(primary.path);
      else void previewItem(primary);
    }
    if (event.key === "F2" && primary) {
      event.preventDefault();
      void renameItem(primary);
    }
    if (event.key === "Escape") {
      event.preventDefault();
      if (preview) setPreview(null);
      else if (menu) setMenu(null);
      else clearSelection();
    }
  }

  return (
    <main
      className="pc-desktop min-h-screen overflow-hidden"
      style={
        backgroundImage
          ? {
              backgroundImage: `linear-gradient(135deg, rgba(7, 10, 13, 0.68), rgba(18, 24, 31, 0.58)), url(${backgroundImage})`,
              backgroundPosition: "center",
              backgroundSize: "cover",
            }
          : undefined
      }
    >
      <section className="relative min-h-screen px-5 py-5 text-[color:var(--pc-text)]">
        <input ref={fileInputRef} type="file" multiple className="hidden" onChange={uploadFiles} />
        <input ref={backgroundInputRef} type="file" accept="image/*" className="hidden" onChange={handleBackgroundFile} />

        <header className="flex items-center justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[color:var(--pc-muted)]">
              PersonalCloud
            </p>
            <h1 className="mt-1 text-2xl font-semibold">Desktop</h1>
          </div>
          <div className="flex items-center gap-2">
            <DesktopButton label="Shortcuts" onClick={() => setShowShortcuts(true)}>
              <Keyboard className="h-4 w-4" />
            </DesktopButton>
            <DesktopButton label="Backgrounds" onClick={() => setShowBackgrounds(true)}>
              <ImagePlus className="h-4 w-4" />
            </DesktopButton>
            <DesktopButton label={theme === "dark" ? "Light mode" : "Dark mode"} onClick={() => setTheme(theme === "dark" ? "light" : "dark")}>
              {theme === "dark" ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
            </DesktopButton>
            <DesktopButton label="Logout" onClick={() => void handleLogout()}>
              <LogOut className="h-4 w-4" />
            </DesktopButton>
          </div>
        </header>

        <button
          type="button"
          onDoubleClick={openRoot}
          onClick={() => {
            if (!isWindowOpen) openRoot();
          }}
          className="mt-10 flex w-24 flex-col items-center gap-2 rounded-xl px-3 py-3 text-center transition hover:bg-[color:var(--pc-hover)]"
        >
          <span className="grid h-16 w-16 place-items-center rounded-2xl bg-gradient-to-br from-sky-300 to-blue-500 text-white shadow-lg shadow-blue-500/20">
            <Folder className="h-9 w-9" />
          </span>
          <span className="text-sm font-medium drop-shadow-sm">Root</span>
        </button>

        {isWindowOpen && !isWindowMinimized ? (
          <ExplorerWindow
            busyState={busyState}
            breadcrumbs={breadcrumbs}
            canGoBack={canGoBack}
            canGoForward={canGoForward}
            clipboard={clipboard}
            currentPath={currentPath}
            error={error}
            folderName={folderName}
            isPreviewLoading={isPreviewLoading}
            listing={listing}
            menu={menu}
            preview={preview}
            selectedItems={selectedItems}
            selectedPaths={selectedPaths}
            smartFilter={smartFilter}
            sortMode={sortMode}
            sortedItems={sortedItems}
            uploadQueue={uploadQueue}
            viewMode={viewMode}
            onBack={goBack}
            onClose={() => setIsWindowOpen(false)}
            onContextMenu={setMenu}
            onCopyPath={(path) => void copyPath(path)}
            onCreateFolder={createFolder}
            onCreateFolderPrompt={() => void createFolderWithPrompt()}
            onDelete={requestDelete}
            onFolderNameChange={setFolderName}
            onForward={goForward}
            onKeyDown={handleExplorerKeyDown}
            onMaximize={() => undefined}
            onMinimize={() => setIsWindowMinimized(true)}
            onNavigate={navigateTo}
            onPaste={() => void transferClipboard()}
            onPreview={(item) => void previewItem(item)}
            onPreviewClose={() => setPreview(null)}
            onRefresh={() => void loadDirectory(currentPath)}
            onRename={(item) => void renameItem(item)}
            onSelect={selectItem}
            onSelectAll={selectAll}
            onSetClipboard={setClipboardFromSelection}
            onSmartFilterChange={setSmartFilter}
            onSortChange={setSortMode}
            onUploadDismiss={(id) => setUploadQueue((previous) => previous.filter((upload) => upload.id !== id))}
            onUploadClick={() => triggerUpload(currentPath)}
            onUploadRoot={() => triggerUpload("")}
            onViewModeChange={setViewMode}
            selectedOrItem={selectedOrItem}
          />
        ) : null}

        {isWindowOpen && isWindowMinimized ? (
          <button
            type="button"
            onClick={() => setIsWindowMinimized(false)}
            className="fixed bottom-6 left-6 flex items-center gap-2 rounded-xl border border-[color:var(--pc-border)] bg-[color:var(--pc-surface)] px-4 py-3 text-sm font-medium shadow-2xl backdrop-blur"
          >
            <Folder className="h-4 w-4 text-blue-400" />
            Root
          </button>
        ) : null}

        {toast ? (
          <div className="fixed bottom-24 right-6 rounded-xl border border-[color:var(--pc-border)] bg-[color:var(--pc-surface)] px-4 py-2 text-sm shadow-xl backdrop-blur">
            {toast}
          </div>
        ) : null}

        <div className="fixed bottom-6 right-6 flex items-center gap-2 rounded-2xl border border-[color:var(--pc-border)] bg-[color:var(--pc-dock)] p-2 shadow-2xl backdrop-blur-xl">
          <DesktopButton label="Upload to Root" onClick={() => triggerUpload("")}>
            <Upload className="h-4 w-4" />
          </DesktopButton>
          <DesktopButton label="Refresh files" onClick={() => void loadDirectory(currentPath)} disabled={!isWindowOpen}>
            <RefreshCcw className="h-4 w-4" />
          </DesktopButton>
          <DesktopButton label="New folder here" onClick={() => void createFolderWithPrompt()} disabled={!isWindowOpen}>
            <FolderPlus className="h-4 w-4" />
          </DesktopButton>
          <DesktopButton label="Paste here" onClick={() => void transferClipboard()} disabled={!isWindowOpen || !clipboard}>
            <Clipboard className="h-4 w-4" />
          </DesktopButton>
        </div>

        <ShortcutsDialog open={showShortcuts} onClose={() => setShowShortcuts(false)} />
        <BackgroundDialog
          backgroundImage={backgroundImage}
          open={showBackgrounds}
          onChooseImage={() => backgroundInputRef.current?.click()}
          onClear={() => setBackgroundImage("")}
          onClose={() => setShowBackgrounds(false)}
        />
        <DeleteDialog
          state={deleteDialog}
          onCancel={() => setDeleteDialog(null)}
          onConfirm={() => void confirmDeleteItems()}
        />
      </section>
    </main>
  );
}

function ExplorerWindow(props: {
  busyState: BusyState;
  breadcrumbs: Array<{ label: string; path: string }>;
  canGoBack: boolean;
  canGoForward: boolean;
  clipboard: ClipboardState;
  currentPath: string;
  error: string;
  folderName: string;
  isPreviewLoading: boolean;
  listing: DirectoryListing | null;
  menu: MenuState;
  preview: PreviewState | null;
  selectedItems: FileItem[];
  selectedPaths: Set<string>;
  smartFilter: SmartFilter;
  sortMode: SortMode;
  sortedItems: FileItem[];
  uploadQueue: UploadState[];
  viewMode: ViewMode;
  onBack: () => void;
  onClose: () => void;
  onContextMenu: (menu: MenuState) => void;
  onCopyPath: (path: string) => void;
  onCreateFolder: (event: FormEvent<HTMLFormElement>) => void;
  onCreateFolderPrompt: () => void;
  onDelete: (items: FileItem[]) => void;
  onFolderNameChange: (value: string) => void;
  onForward: () => void;
  onKeyDown: (event: KeyboardEvent<HTMLElement>) => void;
  onMaximize: () => void;
  onMinimize: () => void;
  onNavigate: (path: string) => void;
  onPaste: () => void;
  onPreview: (item: FileItem) => void;
  onPreviewClose: () => void;
  onRefresh: () => void;
  onRename: (item: FileItem) => void;
  onSelect: (item: FileItem, additive: boolean) => void;
  onSelectAll: () => void;
  onSetClipboard: (mode: "copy" | "cut", fallback?: FileItem) => void;
  onSmartFilterChange: (filter: SmartFilter) => void;
  onSortChange: (mode: SortMode) => void;
  onUploadDismiss: (id: string) => void;
  onUploadClick: () => void;
  onUploadRoot: () => void;
  onViewModeChange: (mode: ViewMode) => void;
  selectedOrItem: (item: FileItem) => FileItem[];
}) {
  return (
    <section
      tabIndex={0}
      onKeyDown={props.onKeyDown}
      className="absolute left-1/2 top-[52%] flex h-[78vh] w-[min(1180px,calc(100vw-32px))] -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-2xl border border-[color:var(--pc-border)] bg-[color:var(--pc-window)] shadow-2xl outline-none backdrop-blur-xl"
    >
      <div className="flex items-center justify-between border-b border-[color:var(--pc-border)] px-4 py-3">
        <div className="flex items-center gap-2">
          <button type="button" onClick={props.onClose} className="h-3.5 w-3.5 rounded-full bg-red-500" aria-label="Close" />
          <button type="button" onClick={props.onMinimize} className="h-3.5 w-3.5 rounded-full bg-yellow-400" aria-label="Minimize" />
          <button type="button" onClick={props.onMaximize} className="h-3.5 w-3.5 rounded-full bg-green-500" aria-label="Maximize" />
          <span className="ml-3 flex items-center gap-2 text-sm font-semibold">
            <HardDrive className="h-4 w-4 text-blue-400" />
            PersonalCloud
          </span>
        </div>
        <div className="flex items-center gap-3">
          <p className="text-xs text-[color:var(--pc-muted)]">
            {props.busyState === "loading" ? "Loading" : `${props.sortedItems.length}/${props.listing?.items.length ?? 0} items`}
          </p>
          <button
            type="button"
            onClick={props.onClose}
            className="grid h-8 w-8 place-items-center rounded-lg bg-[color:var(--pc-button)] text-[color:var(--pc-muted)] transition hover:bg-red-500/15 hover:text-red-200"
            aria-label="Close explorer"
            title="Close explorer"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>

      <div className="flex items-center gap-2 border-b border-[color:var(--pc-border)] px-4 py-3">
        <DesktopButton label="Back" onClick={props.onBack} disabled={!props.canGoBack}>
          <ArrowLeft className="h-4 w-4" />
        </DesktopButton>
        <DesktopButton label="Forward" onClick={props.onForward} disabled={!props.canGoForward}>
          <ArrowRight className="h-4 w-4" />
        </DesktopButton>
        <DesktopButton label="Refresh" onClick={props.onRefresh}>
          <RefreshCcw className="h-4 w-4" />
        </DesktopButton>
        <div className="flex min-w-0 flex-1 items-center gap-1 rounded-xl border border-[color:var(--pc-border)] bg-[color:var(--pc-path)] px-3 py-2 text-sm">
          {props.breadcrumbs.map((crumb, index) => (
            <div key={crumb.path || "root"} className="flex min-w-0 items-center gap-1">
              {index > 0 ? <span className="text-[color:var(--pc-muted)]">/</span> : null}
              <button
                type="button"
                onClick={() => props.onNavigate(crumb.path)}
                className="truncate rounded px-1 text-[color:var(--pc-text)] hover:bg-[color:var(--pc-hover)]"
              >
                {crumb.label}
              </button>
            </div>
          ))}
        </div>
        <DesktopButton label="Upload here" onClick={props.onUploadClick}>
          <Upload className="h-4 w-4" />
        </DesktopButton>
      </div>

      {props.error ? (
        <div className="border-b border-red-300/50 bg-red-500/10 px-4 py-3 text-sm text-red-200">
          {props.error}
        </div>
      ) : null}

      <div className="grid min-h-0 flex-1 grid-cols-[220px_minmax(0,1fr)_320px]">
        <Sidebar
          currentPath={props.currentPath}
          smartFilter={props.smartFilter}
          onNavigate={props.onNavigate}
          onSmartFilterChange={props.onSmartFilterChange}
          onUploadRoot={props.onUploadRoot}
        />
        <div
          className="relative min-h-0 overflow-auto p-5"
          onContextMenu={(event) => {
            event.preventDefault();
            props.onContextMenu({ type: "folder", x: event.clientX, y: event.clientY });
          }}
        >
          <FileArea
            items={props.sortedItems}
            selectedPaths={props.selectedPaths}
            viewMode={props.viewMode}
            onContextMenu={(item, event) => {
              event.preventDefault();
              event.stopPropagation();
              props.onSelect(item, event.ctrlKey || event.metaKey);
              props.onContextMenu({ type: "item", item, x: event.clientX, y: event.clientY });
            }}
            onDelete={(item) => props.onDelete(props.selectedOrItem(item))}
            onMenu={(item, event) => {
              event.stopPropagation();
              props.onSelect(item, event.ctrlKey || event.metaKey);
              props.onContextMenu({ type: "item", item, ...menuPositionFromElement(event.currentTarget) });
            }}
            onNavigate={props.onNavigate}
            onPreview={props.onPreview}
            onRename={props.onRename}
            onSelect={props.onSelect}
          />

          {!props.sortedItems.length && props.busyState !== "loading" ? (
            <div className="grid h-full min-h-[240px] place-items-center text-sm text-[color:var(--pc-muted)]">
              This view is empty. Right-click to upload or create a folder.
            </div>
          ) : null}
        </div>

        <aside className="flex min-h-0 flex-col gap-4 overflow-auto border-l border-[color:var(--pc-border)] p-4">
          <FolderActions
            clipboard={props.clipboard}
            currentPath={props.currentPath}
            folderName={props.folderName}
            selectedCount={props.selectedItems.length}
            sortMode={props.sortMode}
            viewMode={props.viewMode}
            onCopyPath={props.onCopyPath}
            onCreateFolder={props.onCreateFolder}
            onFolderNameChange={props.onFolderNameChange}
            onPaste={props.onPaste}
            onRefresh={props.onRefresh}
            onSelectAll={props.onSelectAll}
            onSortChange={props.onSortChange}
            onUploadClick={props.onUploadClick}
            onViewModeChange={props.onViewModeChange}
          />
          <UploadQueue uploads={props.uploadQueue} onDismiss={props.onUploadDismiss} />
          <PropertiesPanel items={props.selectedItems} />
        </aside>
      </div>

      <PreviewOverlay preview={props.preview} isLoading={props.isPreviewLoading} onClose={props.onPreviewClose} />

      <ContextMenu
        clipboard={props.clipboard}
        currentPath={props.currentPath}
        menu={props.menu}
        selectedItems={props.selectedItems}
        sortMode={props.sortMode}
        viewMode={props.viewMode}
        onCopyPath={props.onCopyPath}
        onCreateFolder={props.onCreateFolderPrompt}
        onDelete={props.onDelete}
        onNavigate={props.onNavigate}
        onPaste={props.onPaste}
        onPreview={props.onPreview}
        onRefresh={props.onRefresh}
        onRename={props.onRename}
        onSetClipboard={props.onSetClipboard}
        onSortChange={props.onSortChange}
        onUploadClick={props.onUploadClick}
        onViewModeChange={props.onViewModeChange}
      />
    </section>
  );
}

function Sidebar({
  currentPath,
  smartFilter,
  onNavigate,
  onSmartFilterChange,
  onUploadRoot,
}: {
  currentPath: string;
  smartFilter: SmartFilter;
  onNavigate: (path: string) => void;
  onSmartFilterChange: (filter: SmartFilter) => void;
  onUploadRoot: () => void;
}) {
  return (
    <aside className="border-r border-[color:var(--pc-border)] bg-black/5 p-3">
      <p className="px-3 pb-2 text-xs font-semibold uppercase tracking-[0.16em] text-[color:var(--pc-muted)]">Favorites</p>
      <SidebarButton active={currentPath === "" && smartFilter === "all"} icon={<HardDrive className="h-4 w-4" />} label="Root" onClick={() => onNavigate("")} />
      <SidebarButton active={smartFilter === "images"} icon={<ImageIcon className="h-4 w-4" />} label="Images" onClick={() => onSmartFilterChange("images")} />
      <SidebarButton active={smartFilter === "videos"} icon={<FileVideo className="h-4 w-4" />} label="Videos" onClick={() => onSmartFilterChange("videos")} />
      <SidebarButton active={smartFilter === "audio"} icon={<FileAudio className="h-4 w-4" />} label="Audio" onClick={() => onSmartFilterChange("audio")} />
      <SidebarButton active={smartFilter === "documents"} icon={<FileText className="h-4 w-4" />} label="Documents" onClick={() => onSmartFilterChange("documents")} />

      <p className="mt-6 px-3 pb-2 text-xs font-semibold uppercase tracking-[0.16em] text-[color:var(--pc-muted)]">Actions</p>
      <SidebarButton active={false} icon={<Upload className="h-4 w-4" />} label="Upload to Root" onClick={onUploadRoot} />
    </aside>
  );
}

function SidebarButton({ active, icon, label, onClick }: { active: boolean; icon: React.ReactNode; label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`mb-1 flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left text-sm transition ${
        active ? "bg-blue-500/18 text-blue-100" : "text-[color:var(--pc-muted)] hover:bg-[color:var(--pc-hover)] hover:text-[color:var(--pc-text)]"
      }`}
    >
      {icon}
      {label}
    </button>
  );
}

function FileArea(props: {
  items: FileItem[];
  selectedPaths: Set<string>;
  viewMode: ViewMode;
  onContextMenu: (item: FileItem, event: React.MouseEvent) => void;
  onDelete: (item: FileItem) => void;
  onMenu: (item: FileItem, event: React.MouseEvent) => void;
  onNavigate: (path: string) => void;
  onPreview: (item: FileItem) => void;
  onRename: (item: FileItem) => void;
  onSelect: (item: FileItem, additive: boolean) => void;
}) {
  if (props.viewMode === "details") {
    return (
      <div className="overflow-hidden rounded-xl border border-[color:var(--pc-border)] bg-[color:var(--pc-panel)]">
        <div className="grid grid-cols-[minmax(180px,1fr)_110px_110px_150px_42px] border-b border-[color:var(--pc-border)] px-3 py-2 text-xs font-semibold uppercase tracking-[0.1em] text-[color:var(--pc-muted)]">
          <span>Name</span>
          <span>Kind</span>
          <span>Size</span>
          <span>Modified</span>
          <span />
        </div>
        {props.items.map((item) => (
          <FileRow key={item.path} item={item} isSelected={props.selectedPaths.has(item.path)} {...props} />
        ))}
      </div>
    );
  }

  return (
    <div className={props.viewMode === "grid" ? "grid grid-cols-[repeat(auto-fill,minmax(118px,1fr))] gap-4" : "flex flex-col gap-2"}>
      {props.items.map((item) => (
        <FileTile key={item.path} item={item} isSelected={props.selectedPaths.has(item.path)} {...props} />
      ))}
    </div>
  );
}

function FileRow({
  item,
  isSelected,
  onContextMenu,
  onMenu,
  onNavigate,
  onPreview,
  onSelect,
}: {
  item: FileItem;
  isSelected: boolean;
  onContextMenu: (item: FileItem, event: React.MouseEvent) => void;
  onDelete: (item: FileItem) => void;
  onMenu: (item: FileItem, event: React.MouseEvent) => void;
  onNavigate: (path: string) => void;
  onPreview: (item: FileItem) => void;
  onRename: (item: FileItem) => void;
  onSelect: (item: FileItem, additive: boolean) => void;
}) {
  const Icon = fileIcon(item);
  return (
    <div
      onContextMenu={(event) => onContextMenu(item, event)}
      className={`grid grid-cols-[minmax(180px,1fr)_110px_110px_150px_42px] items-center border-b border-[color:var(--pc-border)] px-3 py-2 text-sm last:border-b-0 ${
        isSelected ? "bg-blue-500/15" : "hover:bg-[color:var(--pc-hover)]"
      }`}
    >
      <button
        type="button"
        onClick={(event) => onSelect(item, event.ctrlKey || event.metaKey)}
        onDoubleClick={() => (item.kind === "directory" ? onNavigate(item.path) : onPreview(item))}
        className="flex min-w-0 items-center gap-2 text-left"
      >
        <Icon className="h-4 w-4 shrink-0 text-blue-300" />
        <span className="truncate">{item.name}</span>
      </button>
      <span className="text-[color:var(--pc-muted)]">{item.kind === "directory" ? "Folder" : itemExtension(item) || "File"}</span>
      <span className="text-[color:var(--pc-muted)]">{formatBytes(item.size_bytes)}</span>
      <span className="text-[color:var(--pc-muted)]">{formatShortDate(item.modified_at)}</span>
      <FileMenuButton onClick={(event) => onMenu(item, event)} />
    </div>
  );
}

function FileTile({
  item,
  isSelected,
  viewMode,
  onContextMenu,
  onMenu,
  onNavigate,
  onPreview,
  onSelect,
}: {
  item: FileItem;
  isSelected: boolean;
  viewMode: ViewMode;
  onContextMenu: (item: FileItem, event: React.MouseEvent) => void;
  onDelete: (item: FileItem) => void;
  onMenu: (item: FileItem, event: React.MouseEvent) => void;
  onNavigate: (path: string) => void;
  onPreview: (item: FileItem) => void;
  onRename: (item: FileItem) => void;
  onSelect: (item: FileItem, additive: boolean) => void;
}) {
  const Icon = fileIcon(item);

  if (viewMode === "compact") {
    return (
      <div
        onContextMenu={(event) => onContextMenu(item, event)}
        className={`group flex items-center gap-3 rounded-xl border px-3 py-2 transition ${
          isSelected ? "border-blue-400/70 bg-blue-500/15" : "border-transparent bg-[color:var(--pc-tile)] hover:border-[color:var(--pc-border)]"
        }`}
      >
        <button
          type="button"
          onClick={(event) => onSelect(item, event.ctrlKey || event.metaKey)}
          onDoubleClick={() => (item.kind === "directory" ? onNavigate(item.path) : onPreview(item))}
          className="flex min-w-0 flex-1 items-center gap-3 text-left"
        >
          <FileThumb item={item} icon={<Icon className="h-5 w-5" />} size="sm" />
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm font-medium">{item.name}</span>
            <span className="block text-xs text-[color:var(--pc-muted)]">{item.kind === "directory" ? "Folder" : formatBytes(item.size_bytes)}</span>
          </span>
        </button>
        <FileMenuButton onClick={(event) => onMenu(item, event)} />
      </div>
    );
  }

  return (
    <div
      onContextMenu={(event) => onContextMenu(item, event)}
      className={`group relative rounded-2xl border p-3 text-center transition ${
        isSelected ? "border-blue-400/70 bg-blue-500/15 shadow-lg shadow-blue-500/10" : "border-transparent bg-[color:var(--pc-tile)] hover:border-[color:var(--pc-border)] hover:bg-[color:var(--pc-hover)]"
      }`}
    >
      <button
        type="button"
        onClick={(event) => onSelect(item, event.ctrlKey || event.metaKey)}
        onDoubleClick={() => (item.kind === "directory" ? onNavigate(item.path) : onPreview(item))}
        className="mx-auto flex h-[134px] w-full flex-col items-center justify-center gap-3"
      >
        <FileThumb item={item} icon={<Icon className="h-9 w-9" />} size="lg" />
        <span className="line-clamp-2 min-h-9 max-w-full break-words text-xs font-medium leading-4">
          {item.name}
        </span>
      </button>
      <button
        type="button"
        onClick={(event) => onMenu(item, event)}
        className="absolute right-2 top-2 grid h-8 w-8 place-items-center rounded-lg bg-[color:var(--pc-button)] text-[color:var(--pc-muted)] opacity-85 transition hover:bg-[color:var(--pc-hover)] hover:text-[color:var(--pc-text)]"
        aria-label={`Open ${item.name} actions`}
        title="Actions"
      >
        <MoreVertical className="h-4 w-4" />
      </button>
      <p className="mt-1 text-[10px] text-[color:var(--pc-muted)]">{item.kind === "file" ? formatBytes(item.size_bytes) : "Folder"}</p>
    </div>
  );
}

function FileThumb({ item, icon, size }: { item: FileItem; icon: React.ReactNode; size: "sm" | "lg" }) {
  const dimensions = size === "lg" ? "h-16 w-16 rounded-2xl" : "h-10 w-10 rounded-xl";
  if (item.kind === "file" && isImageFile(item.name)) {
    return (
      <span className={`block shrink-0 overflow-hidden bg-black/30 ${dimensions}`}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={`/api/storage/preview?path=${encodeURIComponent(item.path)}`} alt="" className="h-full w-full object-cover" loading="lazy" />
      </span>
    );
  }

  return (
    <span className={item.kind === "directory" ? `grid shrink-0 place-items-center bg-gradient-to-br from-sky-300 to-blue-500 text-white shadow-lg shadow-blue-500/20 ${dimensions}` : `grid shrink-0 place-items-center bg-[color:var(--pc-file)] text-[color:var(--pc-file-icon)] shadow-lg ${dimensions}`}>
      {icon}
    </span>
  );
}

function ContextMenu({
  clipboard,
  currentPath,
  menu,
  selectedItems,
  sortMode,
  viewMode,
  onCopyPath,
  onCreateFolder,
  onDelete,
  onNavigate,
  onPaste,
  onPreview,
  onRefresh,
  onRename,
  onSetClipboard,
  onSortChange,
  onUploadClick,
  onViewModeChange,
}: {
  clipboard: ClipboardState;
  currentPath: string;
  menu: MenuState;
  selectedItems: FileItem[];
  sortMode: SortMode;
  viewMode: ViewMode;
  onCopyPath: (path: string) => void;
  onCreateFolder: () => void;
  onDelete: (items: FileItem[]) => void;
  onNavigate: (path: string) => void;
  onPaste: () => void;
  onPreview: (item: FileItem) => void;
  onRefresh: () => void;
  onRename: (item: FileItem) => void;
  onSetClipboard: (mode: "copy" | "cut", fallback?: FileItem) => void;
  onSortChange: (mode: SortMode) => void;
  onUploadClick: () => void;
  onViewModeChange: (mode: ViewMode) => void;
}) {
  if (!menu) return null;
  const item = menu.type === "item" ? menu.item : null;
  const activeItems = item && selectedItems.some((selected) => selected.path === item.path) ? selectedItems : item ? [item] : [];

  return (
    <div
      className="fixed z-50 w-60 overflow-hidden rounded-xl border border-[color:var(--pc-border)] bg-[color:var(--pc-menu)] p-1 text-sm shadow-2xl backdrop-blur-xl"
      style={{ left: Math.min(menu.x, globalThis.window?.innerWidth ? window.innerWidth - 260 : menu.x), top: Math.min(menu.y, globalThis.window?.innerHeight ? window.innerHeight - 360 : menu.y) }}
      onClick={(event) => event.stopPropagation()}
    >
      {item ? (
        <>
          {item.kind === "directory" ? (
            <>
              <MenuButton icon={<Folder className="h-4 w-4" />} label="Open" onClick={() => onNavigate(item.path)} />
              <MenuLink icon={<Download className="h-4 w-4" />} label="Compress and download" href={`/api/storage/archive?path=${encodeURIComponent(item.path)}`} />
            </>
          ) : (
            <>
              <MenuButton icon={<Eye className="h-4 w-4" />} label="Preview" onClick={() => onPreview(item)} />
              <MenuLink icon={<Download className="h-4 w-4" />} label="Download" href={`/api/storage/download?path=${encodeURIComponent(item.path)}`} />
            </>
          )}
          <MenuSeparator />
          <MenuButton icon={<Copy className="h-4 w-4" />} label={`Copy ${activeItems.length > 1 ? activeItems.length : ""}`} onClick={() => onSetClipboard("copy", item)} />
          <MenuButton icon={<Scissors className="h-4 w-4" />} label={`Cut ${activeItems.length > 1 ? activeItems.length : ""}`} onClick={() => onSetClipboard("cut", item)} />
          <MenuButton icon={<Clipboard className="h-4 w-4" />} label="Paste here" disabled={!clipboard} onClick={onPaste} />
          <MenuButton icon={<Clipboard className="h-4 w-4" />} label="Copy path" onClick={() => onCopyPath(item.path)} />
          <MenuButton icon={<Pencil className="h-4 w-4" />} label="Rename" disabled={activeItems.length !== 1} onClick={() => onRename(item)} />
          <MenuButton icon={<Trash2 className="h-4 w-4" />} label="Move to trash" tone="danger" onClick={() => onDelete(activeItems)} />
          <MenuSeparator />
          <MenuButton icon={<Info className="h-4 w-4" />} label="Properties" onClick={() => onCopyPath(item.path)} />
        </>
      ) : (
        <>
          <MenuButton icon={<Upload className="h-4 w-4" />} label="Upload here" onClick={onUploadClick} />
          <MenuButton icon={<FolderPlus className="h-4 w-4" />} label="New folder" onClick={onCreateFolder} />
          <MenuButton icon={<Clipboard className="h-4 w-4" />} label="Paste here" disabled={!clipboard} onClick={onPaste} />
          <MenuButton icon={<RefreshCcw className="h-4 w-4" />} label="Refresh" onClick={onRefresh} />
          <MenuButton icon={<Clipboard className="h-4 w-4" />} label="Copy current path" onClick={() => onCopyPath(currentPath)} />
          <MenuSeparator />
          <ViewMenuButton mode="grid" viewMode={viewMode} onViewModeChange={onViewModeChange} />
          <ViewMenuButton mode="compact" viewMode={viewMode} onViewModeChange={onViewModeChange} />
          <ViewMenuButton mode="details" viewMode={viewMode} onViewModeChange={onViewModeChange} />
          <MenuSeparator />
          {(["name", "type", "modified", "size"] as SortMode[]).map((mode) => (
            <MenuButton key={mode} icon={sortMode === mode ? <Check className="h-4 w-4" /> : <ArrowDownAZ className="h-4 w-4" />} label={`Sort by ${mode}`} onClick={() => onSortChange(mode)} />
          ))}
        </>
      )}
    </div>
  );
}

function ViewMenuButton({ mode, viewMode, onViewModeChange }: { mode: ViewMode; viewMode: ViewMode; onViewModeChange: (mode: ViewMode) => void }) {
  const icon = mode === "grid" ? <Grid3X3 className="h-4 w-4" /> : mode === "compact" ? <List className="h-4 w-4" /> : <TableProperties className="h-4 w-4" />;
  return <MenuButton icon={viewMode === mode ? <Check className="h-4 w-4" /> : icon} label={`${capitalize(mode)} view`} onClick={() => onViewModeChange(mode)} />;
}

function FolderActions({
  clipboard,
  currentPath,
  folderName,
  selectedCount,
  sortMode,
  viewMode,
  onCopyPath,
  onCreateFolder,
  onFolderNameChange,
  onPaste,
  onRefresh,
  onSelectAll,
  onSortChange,
  onUploadClick,
  onViewModeChange,
}: {
  clipboard: ClipboardState;
  currentPath: string;
  folderName: string;
  selectedCount: number;
  sortMode: SortMode;
  viewMode: ViewMode;
  onCopyPath: (path: string) => void;
  onCreateFolder: (event: FormEvent<HTMLFormElement>) => void;
  onFolderNameChange: (value: string) => void;
  onPaste: () => void;
  onRefresh: () => void;
  onSelectAll: () => void;
  onSortChange: (mode: SortMode) => void;
  onUploadClick: () => void;
  onViewModeChange: (mode: ViewMode) => void;
}) {
  return (
    <section className="rounded-xl border border-[color:var(--pc-border)] bg-[color:var(--pc-panel)] p-3">
      <div className="flex items-center justify-between">
        <p className="text-sm font-semibold">Folder tools</p>
        <button type="button" onClick={() => onCopyPath(currentPath)} className="text-xs text-[color:var(--pc-muted)] hover:text-[color:var(--pc-text)]">
          Copy path
        </button>
      </div>

      <div className="mt-3 grid grid-cols-2 gap-2">
        <ToolButton icon={<Upload className="h-4 w-4" />} label="Upload" onClick={onUploadClick} />
        <ToolButton icon={<RefreshCcw className="h-4 w-4" />} label="Refresh" onClick={onRefresh} />
        <ToolButton icon={<Clipboard className="h-4 w-4" />} label="Paste" onClick={onPaste} disabled={!clipboard} />
        <ToolButton icon={<Check className="h-4 w-4" />} label={`Select ${selectedCount || "all"}`} onClick={onSelectAll} />
      </div>

      <form onSubmit={onCreateFolder} className="mt-3">
        <label className="text-xs font-semibold text-[color:var(--pc-muted)]" htmlFor="folder-name">
          New folder
        </label>
        <div className="mt-2 flex gap-2">
          <input
            id="folder-name"
            value={folderName}
            onChange={(event) => onFolderNameChange(event.target.value)}
            className="min-w-0 flex-1 rounded-lg border border-[color:var(--pc-border)] bg-[color:var(--pc-input)] px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-blue-400/30"
            placeholder="Folder name"
          />
          <button type="submit" className="grid h-10 w-10 place-items-center rounded-lg bg-blue-500 text-white">
            <FolderPlus className="h-4 w-4" />
          </button>
        </div>
      </form>

      <div className="mt-3 grid grid-cols-2 gap-2">
        <select value={sortMode} onChange={(event) => onSortChange(event.target.value as SortMode)} className="pc-select rounded-lg border border-[color:var(--pc-border)] bg-[color:var(--pc-input)] px-2 py-2 text-sm outline-none">
          <option value="name">Name</option>
          <option value="type">Type</option>
          <option value="modified">Modified</option>
          <option value="size">Size</option>
        </select>
        <select value={viewMode} onChange={(event) => onViewModeChange(event.target.value as ViewMode)} className="pc-select rounded-lg border border-[color:var(--pc-border)] bg-[color:var(--pc-input)] px-2 py-2 text-sm outline-none">
          <option value="grid">Grid</option>
          <option value="compact">Compact</option>
          <option value="details">Details</option>
        </select>
      </div>
    </section>
  );
}

function ToolButton({ icon, label, onClick, disabled = false }: { icon: React.ReactNode; label: string; onClick: () => void; disabled?: boolean }) {
  return (
    <button type="button" onClick={onClick} disabled={disabled} className="flex items-center justify-center gap-2 rounded-lg bg-[color:var(--pc-button)] px-3 py-2 text-sm hover:bg-[color:var(--pc-hover)] disabled:cursor-not-allowed disabled:opacity-40">
      {icon}
      {label}
    </button>
  );
}

function UploadQueue({ uploads, onDismiss }: { uploads: UploadState[]; onDismiss: (id: string) => void }) {
  if (!uploads.length) return null;
  return (
    <section className="rounded-xl border border-[color:var(--pc-border)] bg-[color:var(--pc-panel)] p-3">
      <div className="flex items-center justify-between">
        <p className="text-sm font-semibold">Uploads</p>
        <button
          type="button"
          onClick={() => uploads.forEach((upload) => onDismiss(upload.id))}
          className="grid h-7 w-7 place-items-center rounded-lg text-[color:var(--pc-muted)] hover:bg-[color:var(--pc-hover)] hover:text-[color:var(--pc-text)]"
          aria-label="Clear uploads"
          title="Clear uploads"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
      <div className="mt-3 space-y-3">
        {uploads.map((upload) => (
          <div key={upload.id}>
            <div className="flex items-center justify-between gap-2 text-xs">
              <span className="truncate">{upload.name}</span>
              <span className="flex items-center gap-2">
                <span className={upload.status === "error" ? "text-red-300" : "text-[color:var(--pc-muted)]"}>{upload.status}</span>
                <button
                  type="button"
                  onClick={() => onDismiss(upload.id)}
                  className="grid h-5 w-5 place-items-center rounded text-[color:var(--pc-muted)] hover:bg-[color:var(--pc-hover)] hover:text-[color:var(--pc-text)]"
                  aria-label={`Remove ${upload.name} from upload queue`}
                  title="Remove"
                >
                  <X className="h-3 w-3" />
                </button>
              </span>
            </div>
            <div className="mt-1 h-2 overflow-hidden rounded-full bg-black/30">
              <div className={upload.status === "error" ? "h-full bg-red-400" : "h-full bg-blue-400"} style={{ width: `${upload.progress}%` }} />
            </div>
            {upload.error ? <p className="mt-1 text-xs text-red-300">{upload.error}</p> : null}
          </div>
        ))}
      </div>
    </section>
  );
}

function PropertiesPanel({ items }: { items: FileItem[] }) {
  if (!items.length) {
    return (
      <section className="rounded-xl border border-[color:var(--pc-border)] bg-[color:var(--pc-panel)] p-3">
        <p className="text-sm font-semibold">Properties</p>
        <p className="mt-2 text-sm leading-6 text-[color:var(--pc-muted)]">Select one or more items to inspect them.</p>
      </section>
    );
  }

  if (items.length > 1) {
    const totalFiles = items.filter((item) => item.kind === "file").length;
    const totalSize = items.reduce((sum, item) => sum + (item.size_bytes ?? 0), 0);
    return (
      <section className="rounded-xl border border-[color:var(--pc-border)] bg-[color:var(--pc-panel)] p-3">
        <p className="text-sm font-semibold">{items.length} selected</p>
        <p className="mt-2 text-sm text-[color:var(--pc-muted)]">{totalFiles} files</p>
        <p className="mt-1 text-sm text-[color:var(--pc-muted)]">{formatBytes(totalSize)}</p>
      </section>
    );
  }

  const item = items[0];
  return (
    <section className="rounded-xl border border-[color:var(--pc-border)] bg-[color:var(--pc-panel)] p-3">
      <p className="text-sm font-semibold">Properties</p>
      <dl className="mt-3 space-y-2 text-xs">
        <Property label="Name" value={item.name} />
        <Property label="Type" value={item.kind === "directory" ? "Folder" : itemExtension(item) || "File"}/>
        <Property label="Path" value={item.path} />
        <Property label="Size" value={formatBytes(item.size_bytes)} />
        <Property label="Modified" value={formatDate(item.modified_at)} />
      </dl>
    </section>
  );
}

function Property({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-[color:var(--pc-muted)]">{label}</dt>
      <dd className="mt-1 break-words">{value}</dd>
    </div>
  );
}

function ShortcutsDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  if (!open) return null;
  return (
    <DialogFrame title="Keyboard Shortcuts" icon={<Keyboard className="h-4 w-4" />} onClose={onClose}>
      <div className="grid grid-cols-[120px_minmax(0,1fr)] gap-x-4 gap-y-3 text-sm">
        <ShortcutKey value="Enter" label="Open folder or preview selected file" />
        <ShortcutKey value="F2" label="Rename selected item" />
        <ShortcutKey value="Delete" label="Move selected items to trash" />
        <ShortcutKey value="Ctrl+A" label="Select all visible items" />
        <ShortcutKey value="Ctrl+C" label="Copy selected items" />
        <ShortcutKey value="Ctrl+X" label="Cut selected items" />
        <ShortcutKey value="Ctrl+V" label="Paste into current folder" />
        <ShortcutKey value="Esc" label="Close preview/menu or clear selection" />
      </div>
    </DialogFrame>
  );
}

function ShortcutKey({ value, label }: { value: string; label: string }) {
  return (
    <>
      <kbd className="rounded-lg border border-[color:var(--pc-border)] bg-[color:var(--pc-button)] px-2 py-1 text-center text-xs font-semibold">
        {value}
      </kbd>
      <span className="text-[color:var(--pc-muted)]">{label}</span>
    </>
  );
}

function BackgroundDialog({
  backgroundImage,
  open,
  onChooseImage,
  onClear,
  onClose,
}: {
  backgroundImage: string;
  open: boolean;
  onChooseImage: () => void;
  onClear: () => void;
  onClose: () => void;
}) {
  if (!open) return null;
  return (
    <DialogFrame title="Desktop Background" icon={<ImagePlus className="h-4 w-4" />} onClose={onClose}>
      <div className="space-y-4">
        <div className="h-40 overflow-hidden rounded-2xl border border-[color:var(--pc-border)] bg-[color:var(--pc-path)]">
          {backgroundImage ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={backgroundImage} alt="Selected desktop background" className="h-full w-full object-cover" />
          ) : (
            <div className="grid h-full place-items-center text-sm text-[color:var(--pc-muted)]">Default animated background</div>
          )}
        </div>
        <div className="grid grid-cols-2 gap-3">
          <button type="button" onClick={onChooseImage} className="rounded-xl bg-[color:var(--pc-accent)] px-4 py-2.5 text-sm font-semibold text-white">
            Choose image
          </button>
          <button type="button" onClick={onClear} className="rounded-xl border border-[color:var(--pc-border)] bg-[color:var(--pc-button)] px-4 py-2.5 text-sm font-semibold hover:bg-[color:var(--pc-hover)]">
            Use default
          </button>
        </div>
      </div>
    </DialogFrame>
  );
}

function DeleteDialog({
  state,
  onCancel,
  onConfirm,
}: {
  state: DeleteDialogState;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  if (!state) return null;
  const label = state.items.length === 1 ? state.items[0].name : `${state.items.length} selected items`;
  return (
    <DialogFrame title="Move To Trash" icon={<Trash2 className="h-4 w-4" />} onClose={onCancel}>
      <p className="text-sm leading-6 text-[color:var(--pc-muted)]">
        Move <span className="font-semibold text-[color:var(--pc-text)]">{label}</span> to trash? You can add restore support later, but this removes it from the current folder now.
      </p>
      <div className="mt-5 flex justify-end gap-3">
        <button type="button" onClick={onCancel} className="rounded-xl border border-[color:var(--pc-border)] bg-[color:var(--pc-button)] px-4 py-2.5 text-sm font-semibold hover:bg-[color:var(--pc-hover)]">
          Cancel
        </button>
        <button type="button" onClick={onConfirm} className="rounded-xl bg-red-500 px-4 py-2.5 text-sm font-semibold text-white hover:bg-red-400">
          Move to trash
        </button>
      </div>
    </DialogFrame>
  );
}

function DialogFrame({
  children,
  icon,
  title,
  onClose,
}: {
  children: React.ReactNode;
  icon: React.ReactNode;
  title: string;
  onClose: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/45 px-4 backdrop-blur-md" onClick={onClose}>
      <section
        className="w-full max-w-lg rounded-2xl border border-[color:var(--pc-border)] bg-[color:var(--pc-menu)] p-4 shadow-2xl"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between gap-3">
          <h2 className="flex items-center gap-2 text-base font-semibold">
            {icon}
            {title}
          </h2>
          <button type="button" onClick={onClose} className="grid h-8 w-8 place-items-center rounded-lg text-[color:var(--pc-muted)] hover:bg-[color:var(--pc-hover)] hover:text-[color:var(--pc-text)]" aria-label="Close dialog">
            <X className="h-4 w-4" />
          </button>
        </div>
        {children}
      </section>
    </div>
  );
}

function PreviewOverlay({ preview, isLoading, onClose }: { preview: PreviewState | null; isLoading: boolean; onClose: () => void }) {
  if (!preview) return null;

  const previewUrl = `/api/storage/preview?path=${encodeURIComponent(preview.item.path)}`;
  const downloadUrl = `/api/storage/download?path=${encodeURIComponent(preview.item.path)}`;

  return (
    <section className="absolute inset-0 z-40 flex flex-col bg-[color:var(--pc-preview-scrim)] backdrop-blur-xl">
      <div className="flex items-center justify-between border-b border-[color:var(--pc-border)] bg-[color:var(--pc-preview-bar)] px-4 py-3">
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold">{preview.item.name}</p>
          <p className="mt-0.5 text-xs text-[color:var(--pc-muted)]">
            {preview.info.mime_type ?? "Preview"} - {formatBytes(preview.item.size_bytes)}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <a href={downloadUrl} className="inline-flex h-10 items-center gap-2 rounded-xl border border-[color:var(--pc-border)] bg-[color:var(--pc-button)] px-3 text-sm font-semibold transition hover:bg-[color:var(--pc-hover)]">
            <Download className="h-4 w-4" />
            Download
          </a>
          <button type="button" onClick={onClose} className="grid h-10 w-10 place-items-center rounded-xl border border-[color:var(--pc-border)] bg-[color:var(--pc-button)] text-[color:var(--pc-text)] transition hover:bg-red-500/15 hover:text-red-200" aria-label="Close preview" title="Close preview">
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>

      <div className="grid min-h-0 flex-1 place-items-center p-5">
        <div className="flex h-full max-h-full w-full max-w-5xl items-center justify-center overflow-hidden rounded-2xl border border-[color:var(--pc-border)] bg-black/35 shadow-2xl">
          {preview.error ? <p className="rounded-lg bg-red-500/10 px-4 py-3 text-sm text-red-200">{preview.error}</p> : null}
          {preview.info.kind === "image" && preview.info.supported ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={previewUrl} alt={preview.item.name} className="max-h-full max-w-full object-contain" />
          ) : null}
          {preview.info.kind === "pdf" && preview.info.supported ? <iframe title={preview.item.name} src={previewUrl} className="h-full min-h-[520px] w-full border-0" /> : null}
          {preview.info.kind === "audio" && preview.info.supported ? (
            <div className="w-full max-w-xl px-6">
              <FileAudio className="mx-auto mb-6 h-20 w-20 text-blue-300" />
              <audio src={previewUrl} controls className="w-full" />
            </div>
          ) : null}
          {preview.info.kind === "video" && preview.info.supported ? <video src={previewUrl} controls className="max-h-full max-w-full bg-black" /> : null}
          {preview.info.kind === "text" && preview.info.supported ? (
            <pre className="h-full w-full overflow-auto bg-black/80 px-5 py-5 text-sm leading-6 text-white">
              {isLoading ? "Loading preview..." : preview.text}
            </pre>
          ) : null}
          {!preview.info.supported ? (
            <div className="max-w-md rounded-2xl border border-[color:var(--pc-border)] bg-[color:var(--pc-panel)] p-6 text-center">
              <File className="mx-auto h-16 w-16 text-[color:var(--pc-muted)]" />
              <p className="mt-4 text-base font-semibold">Preview not available</p>
              <p className="mt-2 text-sm leading-6 text-[color:var(--pc-muted)]">
                {preview.info.reason ?? "This file type is not supported by the browser-native preview system."}
              </p>
            </div>
          ) : null}
        </div>
      </div>
    </section>
  );
}

function DesktopButton({ label, onClick, children, disabled = false }: { label: string; onClick: () => void; children: React.ReactNode; disabled?: boolean }) {
  return (
    <button type="button" onClick={onClick} disabled={disabled} title={label} aria-label={label} className="grid h-10 w-10 place-items-center rounded-xl border border-[color:var(--pc-border)] bg-[color:var(--pc-button)] text-[color:var(--pc-text)] transition hover:bg-[color:var(--pc-hover)] disabled:cursor-not-allowed disabled:opacity-35">
      {children}
    </button>
  );
}

function FileMenuButton({ onClick }: { onClick: (event: React.MouseEvent) => void }) {
  return (
    <button type="button" onClick={onClick} className="grid h-6 w-6 shrink-0 place-items-center rounded-md bg-[color:var(--pc-button)] text-[color:var(--pc-muted)] transition hover:bg-[color:var(--pc-hover)] hover:text-[color:var(--pc-text)]" aria-label="Open actions" title="Actions">
      <MoreVertical className="h-3.5 w-3.5" />
    </button>
  );
}

function MenuButton({ icon, label, onClick, tone = "normal", disabled = false }: { icon: React.ReactNode; label: string; onClick: () => void; tone?: "normal" | "danger"; disabled?: boolean }) {
  return (
    <button type="button" onClick={onClick} disabled={disabled} className={`flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left transition hover:bg-[color:var(--pc-hover)] disabled:cursor-not-allowed disabled:opacity-40 ${tone === "danger" ? "text-red-300" : "text-[color:var(--pc-text)]"}`}>
      <span className="text-[color:var(--pc-muted)]">{icon}</span>
      {label}
    </button>
  );
}

function MenuLink({ icon, label, href }: { icon: React.ReactNode; label: string; href: string }) {
  return (
    <a href={href} className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left transition hover:bg-[color:var(--pc-hover)]">
      <span className="text-[color:var(--pc-muted)]">{icon}</span>
      {label}
    </a>
  );
}

function MenuSeparator() {
  return <div className="my-1 h-px bg-[color:var(--pc-border)]" />;
}

function buildBreadcrumbs(path: string) {
  const parts = path ? path.split("/") : [];
  return [
    { label: "Root", path: "" },
    ...parts.map((part, index) => ({
      label: part,
      path: parts.slice(0, index + 1).join("/"),
    })),
  ];
}

function filterItems(items: FileItem[], filter: SmartFilter) {
  if (filter === "all") return items;
  return items.filter((item) => {
    if (item.kind === "directory") return false;
    const extension = itemExtension(item);
    if (filter === "images") return IMAGE_EXTENSIONS.has(extension);
    if (filter === "videos") return VIDEO_EXTENSIONS.has(extension);
    if (filter === "audio") return AUDIO_EXTENSIONS.has(extension);
    return DOCUMENT_EXTENSIONS.has(extension);
  });
}

function sortItems(items: FileItem[], mode: SortMode) {
  return [...items].sort((a, b) => {
    if (a.kind !== b.kind) return a.kind === "directory" ? -1 : 1;
    if (mode === "size") return (b.size_bytes ?? -1) - (a.size_bytes ?? -1);
    if (mode === "modified") return new Date(b.modified_at).getTime() - new Date(a.modified_at).getTime();
    if (mode === "type") {
      const typeCompare = itemExtension(a).localeCompare(itemExtension(b));
      if (typeCompare !== 0) return typeCompare;
    }
    return a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
  });
}

function itemExtension(item: FileItem) {
  if (item.kind === "directory") return "folder";
  const parts = item.name.toLowerCase().split(".");
  return parts.length > 1 ? parts.at(-1) ?? "" : "";
}

function fileIcon(item: FileItem) {
  if (item.kind === "directory") return Folder;
  const extension = itemExtension(item);
  if (IMAGE_EXTENSIONS.has(extension)) return FileImage;
  if (VIDEO_EXTENSIONS.has(extension)) return FileVideo;
  if (AUDIO_EXTENSIONS.has(extension)) return FileAudio;
  if (ARCHIVE_EXTENSIONS.has(extension)) return FileArchive;
  if (CODE_EXTENSIONS.has(extension)) return FileCode;
  if (DOCUMENT_EXTENSIONS.has(extension)) return FileText;
  return File;
}

function isImageFile(name: string) {
  const extension = name.toLowerCase().split(".").pop() ?? "";
  return IMAGE_EXTENSIONS.has(extension);
}

function formatBytes(size: number | null) {
  if (size === null) return "-";
  if (size === 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const exponent = Math.min(Math.floor(Math.log(size) / Math.log(1024)), units.length - 1);
  return `${(size / 1024 ** exponent).toFixed(exponent === 0 ? 0 : 1)} ${units[exponent]}`;
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
}

function formatShortDate(value: string) {
  return new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" }).format(new Date(value));
}

function capitalize(value: string) {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function menuPositionFromElement(element: EventTarget & Element) {
  const rect = element.getBoundingClientRect();
  return {
    x: rect.right + 8,
    y: rect.top,
  };
}

function updateUpload(queue: UploadState[], id: string, patch: Partial<UploadState>) {
  return queue.map((upload) => (upload.id === id ? { ...upload, ...patch } : upload));
}

async function readError(response: Response) {
  const data = (await response.json().catch(() => null)) as ApiError | null;
  return data?.error ?? "Request failed";
}

function unsupportedPreviewInfo(item: FileItem, reason: string): PreviewInfo {
  return {
    supported: false,
    kind: "unsupported",
    mime_type: null,
    size_bytes: item.size_bytes ?? 0,
    reason,
  };
}

const IMAGE_EXTENSIONS = new Set(["png", "jpg", "jpeg", "gif", "webp", "svg", "bmp"]);
const VIDEO_EXTENSIONS = new Set(["mp4", "webm", "mov", "mkv"]);
const AUDIO_EXTENSIONS = new Set(["mp3", "wav", "m4a", "flac"]);
const ARCHIVE_EXTENSIONS = new Set(["zip", "rar", "7z", "tar", "gz"]);
const CODE_EXTENSIONS = new Set(["js", "jsx", "ts", "tsx", "py", "css", "html", "json", "xml", "sql", "ps1"]);
const DOCUMENT_EXTENSIONS = new Set(["txt", "md", "pdf", "csv", "log", "doc", "docx", "xls", "xlsx", "ppt", "pptx"]);
