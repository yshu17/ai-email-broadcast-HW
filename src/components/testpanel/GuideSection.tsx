"use client";

import { useState } from "react";
import { useT } from "@/i18n/client";
import type { MessageKey } from "@/i18n/translate";
import { SCENARIO_IDS, SCENARIO_PARTS, scenarioParams, type ScenarioId } from "@/lib/testing/scenarios";
import HelpIcon, { helpSummaryId } from "./HelpIcon";

/**
 * "Scenarios": one card per thing worth testing by hand. Each says what to set first, what to do,
 * which statuses and how many jobs to expect, and how to put everything back. They are read
 * only: nothing here changes a setting, and nothing starts until the person does it.
 */
export default function GuideSection() {
  const { t } = useT();
  const [openId, setOpenId] = useState<ScenarioId | null>(null);
  const params = scenarioParams();

  return (
    <div className="grid gap-2">
      <p className="hint">{t("tp.guide.intro")}</p>
      {SCENARIO_IDS.map((scenario) => {
        const open = openId === scenario;
        const bodyId = `tp-scenario-${scenario}`;
        return (
          <div key={scenario} className="rounded-md border" data-scenario={scenario}>
            <h3 className="m-0 flex items-center pr-2 text-sm font-medium">
              <button
                type="button"
                className="flex-1 px-3 py-2 text-left"
                aria-expanded={open}
                aria-controls={bodyId}
                data-help-id="guideScenario"
                aria-describedby={helpSummaryId("guideScenario", scenario)}
                onClick={() => setOpenId(open ? null : scenario)}
              >
                {t(`scenario.${scenario}.title` as MessageKey)}
              </button>
              <HelpIcon id="guideScenario" instance={scenario} />
            </h3>
            {open ? (
              <div id={bodyId} className="grid gap-3 border-t px-3 py-3 text-xs">
                {SCENARIO_PARTS.map((part) => {
                  const lines = t(`scenario.${scenario}.${part}` as MessageKey, params).split("\n").filter(Boolean);
                  const Tag = part === "steps" ? "ol" : "ul";
                  return (
                    <div key={part}>
                      <p className="font-semibold">{t(`tp.guide.${part}` as MessageKey)}</p>
                      <Tag className={`mt-1 grid gap-0.5 pl-5 ${part === "steps" ? "list-decimal" : "list-disc"}`}>
                        {lines.map((line, index) => <li key={index}>{line}</li>)}
                      </Tag>
                    </div>
                  );
                })}
              </div>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}
