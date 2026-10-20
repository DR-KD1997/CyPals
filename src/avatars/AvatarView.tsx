import { useCallback, useState } from "react";
import type { Companion } from "../core/types";
import { ModelAvatarView } from "./ModelAvatarView";
import { Live2DAvatarView } from "./Live2DAvatarView";
import { PortraitAvatarView } from "./PortraitAvatarView";

interface Props {
  companion: Companion;
  framing: "call" | "overlay";
  reduceMotion: boolean;
}

/** Renders the companion's active avatar of whichever kind. */
export function AvatarView({ companion, framing, reduceMotion }: Props) {
  const [error, setError] = useState<string | null>(null);
  const onError = useCallback((m: string) => setError(m), []);
  const avatar = companion.avatars.find((a) => a.id === companion.activeAvatarId) ?? companion.avatars[0];

  if (!avatar) {
    return (
      <div className="avatar-canvas portrait-empty" aria-hidden>
        {companion.character.name.slice(0, 1)}
      </div>
    );
  }
  if (error) {
    return (
      <div className="avatar-canvas avatar-error" role="alert">
        <p>{error}</p>
        <button className="btn btn-quiet" onClick={() => setError(null)}>Try again</button>
      </div>
    );
  }
  switch (avatar.kind) {
    case "model3d":
      return (
        <ModelAvatarView
          key={avatar.id}
          companion={companion}
          avatar={avatar}
          framing={framing}
          reduceMotion={reduceMotion}
          backgroundColor={companion.presentation.background.type === "color" ? companion.presentation.background.color : undefined}
          onError={onError}
        />
      );
    case "live2d":
      return <Live2DAvatarView key={avatar.id} companion={companion} avatar={avatar} framing={framing} reduceMotion={reduceMotion} onError={onError} />;
    case "portraits":
      return <PortraitAvatarView key={avatar.id} companion={companion} avatar={avatar} framing={framing} reduceMotion={reduceMotion} />;
  }
}
