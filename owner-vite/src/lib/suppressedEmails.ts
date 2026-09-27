/**
 * Addresses Resend has suppressed (hard bounces / spam complaints). Resend
 * will never deliver to these, and each attempt still counts against sender
 * reputation, so the Emails page drops them from every list-based send and
 * from the Old emails 2 batches. Custom (hand-typed) sends are left alone.
 *
 * Source: Resend dashboard → Suppressions → export CSV (2026-09-27).
 * To refresh: re-export and replace the rows below. Lower-cased.
 */
export const SUPPRESSED: ReadonlyArray<readonly [email: string, reason: string]> = [
  ["19988242812@163.com", "bounce"],
  ["aam.wells131@gmail.com", "bounce"],
  ["abikarthi2414104@gmail.com", "bounce"],
  ["admin@shrils.com", "bounce"],
  ["aittouatiousama@gmail.com", "bounce"],
  ["amadfaycel81@gmail.com", "bounce"],
  ["andrew@odakcapital.com", "bounce"],
  ["andrew@odakgroupltd.com", "bounce"],
  ["asavisolutionco@gmail.com", "bounce"],
  ["aswds@gmail.com", "bounce"],
  ["bavgeeen111@gmail.com", "bounce"],
  ["benienouhrane@gmail.com", "bounce"],
  ["bingparis@outlook.be", "bounce"],
  ["brandon.uzila@gmail.com", "bounce"],
  ["chronicchaos@yahoo.com", "bounce"],
  ["dctradez22@gmail.com", "bounce"],
  ["dfafds@fs.com", "bounce"],
  ["dhijanyt@gmail.com", "bounce"],
  ["dom56garia@gmail.com", "bounce"],
  ["edtakahashi@yahoo.com", "complaint"],
  ["ejazyajdani@gmail.com", "bounce"],
  ["ericwsalisbury@yahoo.com", "complaint"],
  ["esnqfx@yahoo.com", "complaint"],
  ["fitmomy2boys@yahoo.com", "bounce"],
  ["greentrader8181@gmail.com", "bounce"],
  ["jack.crept188@8shield.net", "bounce"],
  ["jaydenjp1@hotmail.com", "bounce"],
  ["jennifer_buchwald@web.de", "bounce"],
  ["joo123@gmail.com", "bounce"],
  ["lakshmiganeshvendra@gamil.com", "bounce"],
  ["lantoniocorona21@icloud.com", "bounce"],
  ["luweisas077@gmail.com", "bounce"],
  ["martin.j.hagg@protonmail.com", "bounce"],
  ["md9595oica@gmail.com", "bounce"],
  ["moma@gmail.com", "bounce"],
  ["montanalee47@gmail.com", "bounce"],
  ["nesc39@hotmail.com", "complaint"],
  ["ngy@gmail.com", "bounce"],
  ["oghenevwedejoshua234@gmail.com", "bounce"],
  ["okyaar65@gmail.com", "bounce"],
  ["onefasthorse27@yahoo.com", "complaint"],
  ["ouargagamohamed180@gmail.com", "bounce"],
  ["pcbasscat@frontier.com", "complaint"],
  ["pizzabaguettte426@gmail.com", "bounce"],
  ["propf@gmail.com", "bounce"],
  ["rochdanii71@gmail.com", "bounce"],
  ["sabirqasimi21@hotmail.com", "bounce"],
  ["shawncostas@yahoo.com", "complaint"],
  ["sheikmahid580@gmail.com", "bounce"],
  ["shrilsspam@proton.me", "bounce"],
  ["sp0226@sdvogt.de", "bounce"],
  ["stormtroopercooper@yahoo.com", "bounce"],
  ["sulemanbhutta400@gmail.com", "bounce"],
  ["suzaanmt@gmail.com", "bounce"],
  ["trader1@proppit.com", "bounce"],
  ["ttt44@gmail.com", "bounce"],
  ["vbtrading@posteo.com", "bounce"],
  ["xtremetvservice@gmail.com", "bounce"],
];

export const SUPPRESSED_SET: ReadonlySet<string> = new Set(SUPPRESSED.map(([e]) => e));

export function isSuppressed(email: string): boolean {
  return SUPPRESSED_SET.has((email ?? "").trim().toLowerCase());
}
