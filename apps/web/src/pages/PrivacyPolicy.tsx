import { LegalLayout, LegalSection } from "../components/LegalLayout.js";

const li = "list-disc space-y-1 pl-5";

export function PrivacyPolicyPage() {
  return (
    <LegalLayout title="Privacy Policy" updated="August 4, 2026">
      <LegalSection heading="1. Overview">
        <p>
          Game Manager is a self-hosted game library service. This policy explains what
          information the service collects, how it is used, and which third-party services it
          talks to on your behalf. Because Game Manager is self-hosted, your data lives on the
          server run by the operator of this instance ("the operator"), not on a central service
          run by the developers.
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

      <LegalSection heading="4. Advertising">
        <p>
          Free accounts are ad-supported. Ads are served by <strong>Google AdSense</strong>, a
          third-party advertising network. Premium accounts see no ads: no ad unit is rendered
          for a Premium session.
        </p>
        <p>
          <strong>
            Third-party vendors, including Google, use cookies to serve ads based on your prior
            visits to this website or other websites.
          </strong>{" "}
          Google's use of advertising cookies enables it and its partners to serve ads to you
          based on your visits to this site and/or other sites on the internet. Those cookies
          and similar identifiers are also used to measure ads and cap how often you see them.
          To do this, Google and its partners may process your IP address, your device and
          browser information, and the pages you view here. Google describes this in{" "}
          <a
            href="https://policies.google.com/technologies/partner-sites"
            target="_blank"
            rel="noopener noreferrer"
            className="underline hover:text-zinc-100"
          >
            How Google uses information from sites that use its services
          </a>
          .
        </p>
        <p>
          To be clear about the scope: the AdSense script is loaded on every page of this site,
          including pages you see while signed in. The ad <em>placements</em> in this
          application are only on the public pages — the landing page, the guides, and the
          contact page.
        </p>
        <p>
          You can turn off personalised advertising in{" "}
          <a
            href="https://www.google.com/settings/ads"
            target="_blank"
            rel="noopener noreferrer"
            className="underline hover:text-zinc-100"
          >
            Google Ads Settings
          </a>
          , or opt out of participating vendors' use of cookies at{" "}
          <a
            href="https://www.aboutads.info/choices/"
            target="_blank"
            rel="noopener noreferrer"
            className="underline hover:text-zinc-100"
          >
            aboutads.info
          </a>
          . Where the law requires it — including the EEA, the UK and Switzerland —
          personalised advertising is used only with your consent, which is requested the first
          time you visit and can be changed at any time from the same prompt.
        </p>
      </LegalSection>

      <LegalSection heading="5. Cookies">
        <p>
          Game Manager itself sets a single HTTP-only session cookie to keep you signed in. It
          sets no first-party analytics or tracking cookies — usage statistics are recorded
          server-side against your account, not against a cookie.
        </p>
        <p>
          Google AdSense sets its own cookies for the ad serving, measurement and fraud
          prevention described in section 4. Those are third-party cookies: you can control
          them through your browser's cookie settings or the opt-out links above, and in
          regions where consent is required they are only set once you have given it.
        </p>
      </LegalSection>

      <LegalSection heading="6. Age requirement">
        <p>
          Game Manager is not directed at children. You must be at least <strong>13 years
          old</strong> (or the minimum age of digital consent in your country, if higher) to
          create an account. If we learn that an account belongs to a child under 13, it will be
          deleted along with its data.
        </p>
      </LegalSection>

      <LegalSection heading="7. Data retention and deletion">
        <p>
          Your data is kept for as long as your account exists. Deleting your account removes
          your library, uploads, social connections, and preferences from the database. To
          request deletion or a copy of your data, contact the operator of this instance.
        </p>
      </LegalSection>

      <LegalSection heading="8. Changes to this policy">
        <p>
          Material changes to this policy will be reflected on this page with an updated date
          above. Continued use of the service after a change constitutes acceptance.
        </p>
      </LegalSection>
    </LegalLayout>
  );
}
