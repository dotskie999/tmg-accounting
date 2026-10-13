import { chatGPTSignOutPath, requireChatGPTUser } from "./chatgpt-auth";
import CostFlowApp from "./costflow-app";

export const dynamic = "force-dynamic";

export default async function Home() {
  const user = await requireChatGPTUser("/");
  return (
    <CostFlowApp
      userName={user.displayName}
      signOutPath={chatGPTSignOutPath("/")}
    />
  );
}
