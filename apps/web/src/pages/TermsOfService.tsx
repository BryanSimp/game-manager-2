import { LegalLayout, LegalSection } from "../components/LegalLayout.js";

const li = "list-disc space-y-1 pl-5";

export function TermsOfServicePage() {
  return (
    <LegalLayout title="Terms of Service" updated="August 3, 2026">
      <LegalSection heading="1. Acceptance of terms">
        <p>
          By creating an account or using Game Manager ("the service") you agree to these Terms
          of Service and to the Privacy Policy. If you do not agree, do not use the service.
        </p>
      </LegalSection>

      <LegalSection heading="2. Eligibility">
        <p>
          You must be at least <strong>13 years old</strong> (or the minimum age of digital
          consent in your country, if higher) to use the service. By registering you confirm
          that you meet this requirement.
        </p>
      </LegalSection>

      <LegalSection heading="3. Accounts">
        <p>
          You are responsible for the accuracy of your account information and for keeping your
          password secure. Activity performed under your account is your responsibility. The
          operator of this instance may suspend or remove accounts that violate these terms.
        </p>
      </LegalSection>

      <LegalSection heading="4. Free tier and Premium">
        <p>
          The free tier is supported by advertising: free accounts may be shown clearly-labelled
          ads within the interface. Premium accounts see no ads. Features may differ between
          tiers, and tiers may change over time; material changes will be announced in the app.
        </p>
      </LegalSection>

      <LegalSection heading="5. Your content">
        <p>
          You retain ownership of the content you create (notes, ratings, checklists,
          collections, uploaded images). By publishing a checklist or collection you grant other
          users of this instance the right to view and adopt a copy of it. Do not upload or
          publish content you do not have the right to share, or content that is unlawful,
          infringing, or abusive.
        </p>
      </LegalSection>

      <LegalSection heading="6. Acceptable use">
        <ul className={li}>
          <li>Do not attempt to access other users' private data or bypass permission checks.</li>
          <li>Do not scrape, resell, or redistribute data obtained through the service.</li>
          <li>Do not use the service to violate the terms of the third-party APIs it relies on.</li>
          <li>Do not disrupt or overload the service or its data providers.</li>
        </ul>
      </LegalSection>

      <LegalSection heading="7. Third-party data and trademarks">
        <p>
          Game metadata, covers, and play-time figures are provided by <strong>IGDB</strong> and
          are used under the Twitch Developer Services Agreement and IGDB API terms. Steam
          library and achievement data is retrieved through the official <strong>Steam Web
          API</strong> and is subject to the Steam Web API Terms of Use. Alternate artwork is
          provided by <strong>SteamGridDB</strong> under its API terms. Additional artwork comes
          from Wikimedia Commons and the libretro-thumbnails archive.
        </p>
        <p>
          All game titles, box art, logos, and trademarks displayed in the service belong to
          their respective owners. Game Manager is not affiliated with, sponsored by, or
          endorsed by Valve Corporation, Twitch Interactive (IGDB), SteamGridDB, or any game
          publisher. Content will be removed at the request of a verified rights holder.
        </p>
      </LegalSection>

      <LegalSection heading="8. Disclaimer of warranties">
        <p>
          The service is provided "as is" and "as available", without warranty of any kind.
          Third-party data (metadata, play times, achievements, artwork) may be incomplete or
          inaccurate, and its availability depends on providers outside our control.
        </p>
      </LegalSection>

      <LegalSection heading="9. Limitation of liability">
        <p>
          To the maximum extent permitted by law, the operator and developers of Game Manager
          are not liable for any indirect, incidental, or consequential damages arising from
          your use of the service, including loss of data. Self-hosted instances are operated
          independently; the operator of this instance is responsible for its availability and
          backups.
        </p>
      </LegalSection>

      <LegalSection heading="10. Termination">
        <p>
          You may stop using the service and delete your account at any time. The operator may
          suspend or terminate accounts that breach these terms, with data handled as described
          in the Privacy Policy.
        </p>
      </LegalSection>

      <LegalSection heading="11. Changes to these terms">
        <p>
          These terms may be updated from time to time; the date above reflects the latest
          revision. Continued use of the service after a change constitutes acceptance of the
          revised terms.
        </p>
      </LegalSection>
    </LegalLayout>
  );
}
