"use client";

import { TelegramSettings } from "@/components/TelegramSettings";
import { Applies } from "@/components/settings/Applies";
import { SettingsCard } from "@/components/settings/SettingsCard";
import { useT } from "@/lib/use-i18n";

function ChannelsContent() {
  const t = useT();
  return (
    <div className="space-y-6">
      <section
        id="setting-channels-telegram"
        data-setting-id="setting-channels-telegram"
        data-setting-container
        tabIndex={-1}
        aria-label={t("channels.telegramTitle")}
      >
        <SettingsCard
          title="Optional Telegram alerts"
          description="Get a nudge when something needs you. Open the website to chat."
          action={<Applies when="now" />}
        >
          <TelegramSettings />
        </SettingsCard>
      </section>


    </div>
  );
}

export function ChannelsSettings() {
  return <ChannelsContent />;
}
