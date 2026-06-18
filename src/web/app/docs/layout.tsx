import { Sidebar } from '@/components/docs/sidebar';
import { Toc } from '@/components/docs/toc';
import { TopNav } from '@/components/nav/top-nav';

export default function DocsLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <TopNav />
      <div className="mx-auto max-w-7xl px-4 sm:px-6">
        <div className="grid grid-cols-1 gap-8 pt-6 pb-20 lg:grid-cols-[220px_minmax(0,1fr)_200px] lg:gap-10 lg:pt-10 lg:pb-24">
          <aside className="hidden lg:block sticky top-20 self-start max-h-[calc(100vh-6rem)] overflow-y-auto pr-2">
            <Sidebar />
          </aside>
          <article className="min-w-0">{children}</article>
          <aside className="hidden lg:block sticky top-20 self-start max-h-[calc(100vh-6rem)] overflow-y-auto pl-2">
            <Toc />
          </aside>
        </div>
      </div>
    </>
  );
}
