import type { Issue } from "@pulse/shared";

type PublishCredentials = {
  BEEHIIV_API_KEY?: string;
  BEEHIIV_PUBLICATION_ID?: string;
  X_API_KEY?: string;
  REDDIT_CLIENT_ID?: string;
  REDDIT_CLIENT_SECRET?: string;
  TELEGRAM_BOT_TOKEN?: string;
  TELEGRAM_CHAT_ID?: string;
};

export type PublishPlan = {
  liveSend: false;
  reason: string;
  channels: {
    id: "beehiiv" | "x" | "reddit" | "telegram";
    configured: boolean;
    sent: false;
    payload: Record<string, string>;
  }[];
};

export function preparePublish(issue: Issue, env: PublishCredentials): PublishPlan {
  const summary = `${issue.subject}\n\n${issue.preheader}\n\n${issue.footer}`;
  return {
    liveSend: false,
    reason: "Live sends are disabled. Nothing was posted.",
    channels: [
      {
        id: "beehiiv",
        configured: Boolean(env.BEEHIIV_API_KEY && env.BEEHIIV_PUBLICATION_ID),
        sent: false,
        payload: { title: issue.subject, body: issue.body, status: "draft" },
      },
      {
        id: "x",
        configured: Boolean(env.X_API_KEY),
        sent: false,
        payload: { text: issue.subject },
      },
      {
        id: "reddit",
        configured: Boolean(env.REDDIT_CLIENT_ID && env.REDDIT_CLIENT_SECRET),
        sent: false,
        payload: { title: issue.subject, text: summary },
      },
      {
        id: "telegram",
        configured: Boolean(env.TELEGRAM_BOT_TOKEN && env.TELEGRAM_CHAT_ID),
        sent: false,
        payload: { text: summary },
      },
    ],
  };
}
