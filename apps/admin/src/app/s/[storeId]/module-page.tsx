"use client";

import { Badge, Card, EmptyState, FeatureList, Page, PageHeader, PlusIcon } from "@workeasy/ui/react";
import { moduleByKey, type ModuleKey } from "../../../lib/modules";
import { useStore } from "./store-shell";

/**
 * A module that is not built yet, on the same skeleton every module uses:
 * page header with its primary action, then the empty state the module will
 * show before it has data, and what the module will do.
 */
export function ModulePage({ moduleKey }: { moduleKey: ModuleKey }) {
  const ctx = useStore();
  const mod = moduleByKey(moduleKey);
  const allowed = !mod.permission || (ctx?.can(mod.permission) ?? false);

  if (ctx && !allowed) {
    return (
      <Page>
        <PageHeader title={mod.label} eyebrow={mod.group} />
        <EmptyState icon={mod.icon(26)} title={`You don't have access to ${mod.label}`}>
          Ask a store owner or admin to change your role if you need it.
        </EmptyState>
      </Page>
    );
  }

  return (
    <Page>
      <PageHeader
        title={mod.label}
        eyebrow={
          <>
            {mod.group}
            {mod.phase !== undefined && <Badge tone="info">Coming soon</Badge>}
          </>
        }
        subtitle={mod.summary}
        actions={
          mod.primaryAction && (
            <button type="button" className="c-btn c-btn-primary" disabled title="Available when this module launches">
              <PlusIcon size={16} /> {mod.primaryAction}
            </button>
          )
        }
      />
      <EmptyState icon={mod.icon(26)} title={`${mod.label} is on its way`}>
        This module is being built{mod.phase !== undefined ? ` in phase ${mod.phase} of the roadmap` : ""}. Everything you set up elsewhere in your store is kept and will appear here
        automatically.
      </EmptyState>
      {mod.features.length > 0 && (
        <div className="c-section">
          <Card title="What you'll be able to do">
            <FeatureList items={mod.features} />
          </Card>
        </div>
      )}
    </Page>
  );
}
