'use client';

import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Lightbulb } from 'lucide-react';
import { SCENARIO, cumulativeCost, costInUSD, effectiveCost } from './scenario-data';
import type { DemoMessage } from './conversation-panel';
import { ConversationPanel } from './conversation-panel';
import { PromptInput } from './prompt-input';
import { CostChart } from './cost-chart';
import { cn } from '@/lib/cn';

export function DemoPlayground() {
  const [currentTurn, setCurrentTurn] = useState(0);
  const [messages, setMessages] = useState<DemoMessage[]>([]);
  const [isAnimating, setIsAnimating] = useState(false);
  const [activeTab, setActiveTab] = useState<'standard' | 'cachelane'>('cachelane');

  const handleSend = async (userPrompt: string) => {
    if (currentTurn >= SCENARIO.length) return;
    setIsAnimating(true);
    const turnData = SCENARIO[currentTurn];

    // Add user message immediately
    const userMsg: DemoMessage = {
      id: `user-${currentTurn}`,
      role: 'user',
      content: userPrompt,
    };
    setMessages((prev) => [...prev, userMsg]);

    // Simulate network delay
    await new Promise((resolve) => setTimeout(resolve, 800));

    // Handle tool calls if any
    if (turnData.toolCalls) {
      for (const tool of turnData.toolCalls) {
        setMessages((prev) => [
          ...prev,
          {
            id: `toolcall-${currentTurn}-${tool.name}`,
            role: 'tool_call',
            content: tool.args,
            toolName: tool.name,
          },
        ]);
        
        await new Promise((resolve) => setTimeout(resolve, 600));
        
        setMessages((prev) => [
          ...prev,
          {
            id: `toolresult-${currentTurn}-${tool.name}`,
            role: 'tool_result',
            content: tool.output,
          },
        ]);
        
        await new Promise((resolve) => setTimeout(resolve, 800));
      }
    }

    // Add stub event if applicable
    if (turnData.cachelaneEvents.includes('stub_created')) {
      // Find the auth.ts tool result in standard layout, it's roughly 3200 tokens
      setMessages((prev) => [
        ...prev,
        {
          id: `stub-${currentTurn}`,
          role: 'stub',
          content: 'auth.ts (3,150 tokens removed)',
          tokensSaved: 3150,
        },
      ]);
      await new Promise((resolve) => setTimeout(resolve, 500));
    }

    // Add assistant response and attach turnIndex to trigger stats rendering
    setMessages((prev) => [
      ...prev,
      {
        id: `assistant-${currentTurn}`,
        role: 'assistant',
        content: turnData.assistantResponse,
        turnIndex: turnData.turn,
      },
    ]);

    setCurrentTurn(currentTurn + 1);
    setIsAnimating(false);
  };

  const handleReset = () => {
    setCurrentTurn(0);
    setMessages([]);
  };

  const turnStats = SCENARIO.slice(0, currentTurn).map((t) => ({
    turnIndex: t.turn,
    breakdown: t.standard,
    events: [],
  }));

  const cachelaneTurnStats = SCENARIO.slice(0, currentTurn).map((t) => {
    const stdUnits = effectiveCost(t.standard);
    const clUnits = effectiveCost(t.cachelane);
    const savedUsd = costInUSD(stdUnits - clUnits);
    
    return {
      turnIndex: t.turn,
      breakdown: t.cachelane,
      events: t.cachelaneEvents,
      regions: t.regions,
      savedUsd: savedUsd > 0 ? savedUsd : 0,
    };
  });

  const costData = SCENARIO.map((t) => ({
    turn: t.turn,
    standardCumulative: cumulativeCost(SCENARIO, t.turn, 'standard'),
    cachelaneCumulative: cumulativeCost(SCENARIO, t.turn, 'cachelane'),
  }));

  const stdCost = cumulativeCost(SCENARIO, currentTurn, 'standard');
  const clCost = cumulativeCost(SCENARIO, currentTurn, 'cachelane');
  const isComplete = currentTurn >= SCENARIO.length;

  const currentTeaching = currentTurn > 0 ? SCENARIO[currentTurn - 1].teachingMoment : null;

  return (
    <div className="mx-auto flex max-w-7xl flex-col gap-6 p-4 md:p-6 lg:p-8">
      {/* Top Input Bar */}
      <div className="mx-auto w-full max-w-3xl">
        <PromptInput
          suggestedPrompt={isComplete ? '' : SCENARIO[currentTurn].suggestedPrompt}
          currentTurn={currentTurn}
          totalTurns={SCENARIO.length}
          isAnimating={isAnimating}
          onSend={handleSend}
          onReset={handleReset}
          isComplete={isComplete}
        />
      </div>

      {/* Teaching Moment Banner */}
      <AnimatePresence mode="wait">
        {currentTeaching && (
          <motion.div
            key={currentTurn}
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, height: 0 }}
            className="mx-auto flex w-full max-w-3xl items-start gap-3 rounded-xl border border-[var(--color-border)] bg-[color-mix(in_oklch,var(--color-accent),transparent_95%)] p-4 shadow-sm"
          >
            <div className="mt-0.5 shrink-0 text-[var(--color-accent)]">
              <Lightbulb size={20} />
            </div>
            <div>
              <h4 className="text-sm font-bold text-[var(--color-fg)]">
                {currentTeaching.title}
              </h4>
              <p className="mt-1 text-sm leading-relaxed text-[var(--color-fg-muted)]">
                {currentTeaching.description}
              </p>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Main Panels & Chart Layout */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2 lg:gap-8">
        {/* Mobile Tabs */}
        <div className="flex w-full rounded-lg bg-[var(--color-bg-elev)] p-1 lg:hidden">
          <button
            onClick={() => setActiveTab('standard')}
            className={cn(
              'flex-1 rounded-md px-3 py-2 text-sm font-bold transition-colors',
              activeTab === 'standard'
                ? 'bg-[var(--color-bg)] text-[var(--color-danger)] shadow-sm'
                : 'text-[var(--color-fg-muted)] hover:text-[var(--color-fg)]'
            )}
          >
            Standard
          </button>
          <button
            onClick={() => setActiveTab('cachelane')}
            className={cn(
              'flex-1 rounded-md px-3 py-2 text-sm font-bold transition-colors',
              activeTab === 'cachelane'
                ? 'bg-[var(--color-bg)] text-[var(--color-success)] shadow-sm'
                : 'text-[var(--color-fg-muted)] hover:text-[var(--color-fg)]'
            )}
          >
            CacheLane
          </button>
        </div>

        {/* Standard Panel */}
        <div className={cn('h-[600px] lg:block', activeTab === 'standard' ? 'block' : 'hidden')}>
          <ConversationPanel
            variant="standard"
            messages={messages}
            turnStats={turnStats}
            currentTurn={currentTurn}
            cumulativeCost={stdCost}
          />
        </div>

        {/* CacheLane Panel */}
        <div className={cn('h-[600px] lg:block', activeTab === 'cachelane' ? 'block' : 'hidden')}>
          <ConversationPanel
            variant="cachelane"
            messages={messages}
            turnStats={cachelaneTurnStats}
            currentTurn={currentTurn}
            cumulativeCost={clCost}
          />
        </div>
      </div>

      {/* Chart */}
      <div className="mx-auto w-full max-w-4xl">
        <CostChart data={costData} currentTurn={currentTurn} />
      </div>
    </div>
  );
}
