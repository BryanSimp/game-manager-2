import { GITHUB_REPO_URL } from "@gm/shared";
import { LegalLayout, LegalSection } from "../components/LegalLayout.js";
import { useSeo } from "../lib/seo.js";

const li = "list-disc space-y-1 pl-5";

export function PrivacyPolicyPage() {
  useSeo({
    title: "Privacy Policy",
    description:
      "How Game Manager handles your account data, your game library, cookies and the third-party services it talks to on your behalf.",
    path: "/privacy",
  });

  return (
    <LegalLayout title="Privacy Policy" updated="August 4, 2026">
      <LegalSection heading="1. Overview">
        <p>
          Game Manager is a self-hosted game library service. This policy explains what
          information the service collects, how it is used, and which third-party services it
          talks to on your behalf. Because Game Manager is self-hosted, your data lives on the
          server run by the operator of this instance ("the operator"), not on a central service
          run by the developers. The source is public, so everything described here can be
          checked against the code at{" "}
          <a
            href={GITHUB_REPO_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="underline hover:text-zinc-100"
          >
            github.com/BryanSimp/game-manager-2
          </a>
          .
        </p>
      </LegalSection>

      <LegalSection heading="2. Information we collect">
        <ul className={li}>
          <li>
            <strong>Account data:</strong> your email address, display name, and a securely
            hashed password. Sessions store an HTTP-only cookie plus the IP address and browser
            user-agent of each active session.
          </li>
          <li>
            <strong>Library data:</strong> the games you add, their categories, ratings, notes,
            play times, platforms and consoles you own, tags, checklists, collections, and
            progress. Notes are private to you and are never shown to friends.
          </li>
          <li>
            <strong>Uploads:</strong> cover art, console art, and screenshots or shelf photos you
            submit for import. Uploaded images are stored on the server's data volume.
          </li>
          <li>
            <strong>Social data:</strong> your friend code, friend requests, and accepted
            friendships. Friends can see your library entries (status, rating, platforms, and
            completion) — never your notes.
          </li>
        </ul>
      </LegalSection>

      <LegalSection heading="3. Third-party services">
        <p>
          Game Manager fetches game data from third-party APIs. Requests are made server-side;
          your account details are not sent to these services unless stated below.
        </p>
        <ul className={li}>
          <li>
            <strong>IGDB (Twitch Interactive):</strong> game titles you search for are sent to
            IGDB to retrieve metadata, covers, and play-time figures. Data is used under the
            Twitch Developer Services Agreement and the IGDB API terms.
          </li>
          <li>
            <strong>Steam (Valve Corporation):</strong> if you link a Steam account, your SteamID
            and the appids of your games are sent to the official Steam Web API to import your
            owned games, playtime, and achievements. This requires your Steam "Game details"
            privacy setting to be public. Unlinking stops all further requests.
          </li>
          <li>
            <strong>SteamGridDB:</strong> when you browse alternate covers, the game's name or
            Steam appid is sent to SteamGridDB to find community artwork.
          </li>
          <li>
            <strong>UPCitemdb:</strong> barcodes you scan are sent to UPCitemdb to identify the
            product. Only the barcode digits are transmitted.
          </li>
          <li>
            <strong>Wikimedia Commons and libretro-thumbnails:</strong> queried for console logos
            and retail box-art scans. Only platform or game names are transmitted.
          </li>
          <li>
            <strong>Fandom wikis:</strong> when you import a mission list, the game's title is
            used to query the relevant public wiki.
          </li>
          <li>
            <strong>Anthropic (Claude vision):</strong> if the operator has configured an
            Anthropic API key, images you submit for OCR import (e.g. shelf photos) are sent to
            Anthropic's API for text extraction, subject to Anthropic's privacy policy.
          </li>
        </ul>
      </LegalSection>

      <LegalSection heading="4. Cookies">
        <p>
          Game Manager itself sets a single HTTP-only session cookie to keep you signed in. It
          sets no first-party analytics or tracking cookies — usage statistics are recorded
          server-side against your account, not against a cookie.
        </p>
        <p>
          No third-party advertising cookies are set: the site carries no ads and loads no ad
          network's script. The only cookies in play are the session cookie above and, if you
          ask to be remembered past a two-factor challenge, the trusted-device cookie that
          records that choice.
        </p>
      </LegalSection>

      <LegalSection heading="5. Age requirement">
        <p>
          Game Manager is not directed at children. You must be at least <strong>13 years
          old</strong> (or the minimum age of digital consent in your country, if higher) to
          create an account. If we learn that an account belongs to a child under 13, it will be
          deleted along with its data.
        </p>
      </LegalSection>

      <LegalSection heading="6. Data retention and deletion">
        <p>
          Your data is kept for as long as your account exists. Deleting your account removes
          your library, uploads, social connections, and preferences from the database. To
          request deletion or a copy of your data, contact the operator of this instance.
        </p>
      </LegalSection>

      <LegalSection heading="7. Changes to this policy">
        <p>
          Material changes to this policy will be reflected on this page with an updated date
          above. Continued use of the service after a change constitutes acceptance.
        </p>
      </LegalSection>
    </LegalLayout>
  );
}
