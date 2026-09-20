import { useEffect } from 'react';
import type { ReactElement } from 'react';
import { BottomPanel } from './ui/BottomPanel';
import { LeftSidebar } from './ui/LeftSidebar';
import { RightSidebar } from './ui/RightSidebar';
import { Toasts } from './ui/Toasts';
import { Viewport } from './ui/Viewport';
import { installLaunchQueue, installTestHooks, refreshRecent } from './ui/actions';

export function App(): ReactElement {
  useEffect(() => {
    void refreshRecent();
    installLaunchQueue();
    installTestHooks();
    // A drop anywhere else on the page must not navigate away.
    const block = (event: DragEvent) => event.preventDefault();
    window.addEventListener('dragover', block);
    window.addEventListener('drop', block);
    return () => {
      window.removeEventListener('dragover', block);
      window.removeEventListener('drop', block);
    };
  }, []);
  return (
    <div className="app">
      <LeftSidebar />
      <main className="center">
        <Viewport />
        <BottomPanel />
      </main>
      <RightSidebar />
      <Toasts />
    </div>
  );
}
