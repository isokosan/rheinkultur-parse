const { ensureUniqueField } = require('@/utils')
const CookieConsent = Parse.Object.extend('CookieConsent')

const { v4: uuidv4 } = require('uuid')

const SERVICES = {
  googleMaps: {
    name: 'Google Maps',
    category: 'essential',
    lastUpdated: '2023-08-21T00:00:00.000Z',
    description: `
      <div>
        <div>
          <div>Beschreibung des Services</div>
          <div>Dies ist ein integrierter Kartendienst.</div>
        </div>
        <div>
          <div>Verarbeitendes Unternehmen</div>
          <div>Google Ireland Limited<br />Gordon House, 4 Barrow St, Dublin 4, Ireland</div>
        </div>
        <div>
          <div>Datenschutzbeauftragter des verarbeitenden Unternehmens</div>
          <div>Nachfolgend finden Sie die E-Mail-Adresse des Datenschutzbeauftragten des verarbeitenden Unternehmens.</div>
          <a tabindex="0" href="https://support.google.com/policies/contact/general_privacy_form" target="_blank" rel="noopener">https://support.google.com/policies/contact/general_privacy_form</a></div>
        <div>
          <div>Zweck der Daten</div>
          <div>Diese Liste stellt die Zwecke der Datenerhebung und -verarbeitung dar.</div>
          <ul class="boxes">
            <li>Karten anzeigen</li>
          </ul>
        </div>
        <div>
          <div>Genutzte Technologien</div>
          <div>In dieser Liste sind alle Technologien aufgef&uuml;hrt, die dieser Dienst zur Datenerfassung verwendet.</div>
          <ul class="boxes">
            <li>API</li>
          </ul>
        </div>
        <div>
          <div>Gesammelte Daten</div>
          <div>Diese Liste enth&auml;lt alle (pers&ouml;nlichen) Daten, die von oder durch die Nutzung dieses Dienstes gesammelt werden.</div>
          <ul class="boxes">
            <li>Datum und Uhrzeit des Besuchs</li>
            <li>Standort-Informationen</li>
            <li>IP-Adresse</li>
            <li>URL</li>
            <li>Nutzungsdaten</li>
            <li>Suchbegriffe</li>
            <li>Geografischer Standort</li>
          </ul>
        </div>
        <div>
          <div>Rechtliche Grundlage</div>
          <div>Im Folgenden wird die erforderliche Rechtsgrundlage f&uuml;r die Verarbeitung von Daten genannt</div>
          <ul class="boxes">
            <li>Art. 6 Abs. 1 S. 1 lit. a DSGVO</li>
          </ul>
        </div>
        <div>
          <div>Ort der Verarbeitung</div>
          <div>Dies ist der prim&auml;re Ort, an dem die gesammelten Daten verarbeitet werden. Sollten die Daten auch in anderen L&auml;ndern verarbeitet werden, werden Sie gesondert informiert.</div>
          <ul>
            <li>
              <div>Europ&auml;ische Union</div>
            </li>
          </ul>
        </div>
        <div>
          <div>Aufbewahrungsdauer</div>
          <div>Die Aufbewahrungsdauer ist die Zeitspanne, in der die gesammelten Daten f&uuml;r die Verarbeitung gespeichert werden. Die Daten m&uuml;ssen gel&ouml;scht werden, sobald sie f&uuml;r die angegebenen Verarbeitungszwecke nicht mehr ben&ouml;tigt werden.</div>
          <ul>
            <li>
              <div>Daten werden gel&ouml;scht, sobald sie f&uuml;r die Verarbeitungszwecke nicht mehr ben&ouml;tigt werden.</div>
            </li>
          </ul>
        </div>
        <div>
          <div>Weitergabe an Drittl&auml;nder</div>
          <div>Bei in Inanspruchnahme dieser Dienstleistung k&ouml;nnen die gesammelten Daten in ein anderes Land weitergeleitet werden. Bitte beachten Sie, dass im Rahmen dieser Dienstleistung die Daten m&ouml;glicherweise in ein Land &uuml;bertragen werden, das nicht &uuml;ber die erforderlichen Datenschutznormen verf&uuml;gt. Falls die Daten in die USA &uuml;bertragen werden, besteht das Risiko, dass Ihre Daten von US-Beh&ouml;rden f&uuml;r Kontroll- und &Uuml;berwachungsma&szlig;nahmen verarbeitet werden, ohne dass Rechtsmittel dagegen eingelegt werden k&ouml;nnen. Nachstehend finden Sie eine Liste der L&auml;nder, in die die Daten &uuml;bertragen werden. Weitere Informationen zu den Sicherheitsma&szlig;nahmen entnehmen Sie bitte der Datenschutzerkl&auml;rung des jeweiligen Anbieters oder wenden Sie sich unmittelbar an den Anbieter selbst.</div>
          <ul class="boxes">
            <li>Vereinigte Staaten von Amerika</li>
            <li>Singapur</li>
            <li>Taiwan</li>
            <li>Chile</li>
          </ul>
        </div>
        <div>
          <div>Datenempf&auml;nger</div>
          <div>Im Folgenden werden die Empf&auml;nger der erhobenen Daten aufgelistet.</div>
          <ul class="boxes">
            <li>Google Ireland Limited, Google LLC, Alphabet Inc</li>
          </ul>
        </div>
        <div>
          <div>Klicken Sie hier, um die Datenschutzbestimmungen des Datenverarbeiters zu lesen.</div>
          <a tabindex="0" href="https://policies.google.com/privacy?hl=de" target="_blank" rel="noopener">https://policies.google.com/privacy?hl=de</a>
        </div>
        <div>
          <div>Klicken Sie hier, um die Cookie-Richtlinie des Datenverarbeiters zu lesen.</div>
          <a tabindex="0" href="https://policies.google.com/technologies/cookies?hl=de" target="_blank" rel="noopener" data-testid="uc-settings-cookie-link">https://policies.google.com/technologies/cookies?hl=de</a>
        </div>
      </div>
    `,
    savedInfos: [
      {
        title: 'NID',
        description: 'Dieses Cookie wird verwendet, um die Benutzereinstellungen zu speichern.',
        type: 'cookie',
        duration: '6 Monate'
      }
    ]
  },
  mapTiler: {
    name: 'MapTiler',
    category: 'essential',
    lastUpdated: '2023-08-21T00:00:00.000Z',
    description: `
      <div>
        <div>
          <div>
            Beschreibung des Services
          </div>
          <div>
            Dies ist ein Kartendienst. Es kann verwendet werden, um Karten in Webanwendungen und mobilen Ger&auml;ten zu ver&ouml;ffentlichen.
          </div>
        </div>
        <div>
          <div>
            Verarbeitendes Unternehmen
          </div>
          <div>
            MapTiler AG
            <br />
            H&ouml;fnerstrasse 98, 6314 Unter&auml;geri, Switzerland
          </div>
        </div>
        <div>
          <div>
            Zweck der Daten
          </div>
          <div>
            Diese Liste stellt die Zwecke der Datenerhebung und -verarbeitung dar.
          </div>
          <ul class="boxes">
            <li>
              Bereitstellung von Online-Karten
            </li>
          </ul>
        </div>
        <div>
          <div>
            Gesammelte Daten
          </div>
          <div>
            Diese Liste enth&auml;lt alle (pers&ouml;nlichen) Daten, die von oder durch die Nutzung dieses Dienstes gesammelt werden.
          </div>
          <ul class="boxes">
            <li>
              IP-Adresse
            </li>
          </ul>
        </div>
        <div>
          <div>
            Rechtliche Grundlage
          </div>
          <div>
            Im Folgenden wird die erforderliche Rechtsgrundlage f&uuml;r die Verarbeitung von Daten genannt
          </div>
          <ul class="boxes">
            <li>
              Art. 6 Abs. 1 S. 1 lit. a DSGVO
            </li>
          </ul>
        </div>
        <div>
          <div>
            Ort der Verarbeitung
          </div>
          <div>
            Dies ist der prim&auml;re Ort, an dem die gesammelten Daten verarbeitet werden. Sollten die Daten auch in anderen L&auml;ndern verarbeitet werden, werden Sie gesondert informiert.
          </div>
          <ul>
            <li>
              <div>
                Schweiz,Europ&auml;ische Union
              </div>
            </li>
          </ul>
        </div>
        <div>
          <div>
            Datenempf&auml;nger
          </div>
          <div>
            Im Folgenden werden die Empf&auml;nger der erhobenen Daten aufgelistet.
          </div>
          <ul class="boxes">
            <li>
              MapTiler AG
            </li>
          </ul>
        </div>
        <div>
          <div>
            Klicken Sie hier, um die Datenschutzbestimmungen des Datenverarbeiters zu lesen.
          </div>
          <a tabindex="0" href="https://www.maptiler.com/privacy-policy/" target="_blank" rel="noopener">
            https://www.maptiler.com/privacy-policy/
          </a>
        </div>
        <div>
          <div>
            Speicherinformation
          </div>
          <div>
            Unten sehen Sie die l&auml;ngste m&ouml;gliche Speicherungsdauer auf einem Ger&auml;t, abh&auml;ngig von der verwendeten Speichermethode.
          </div>
          <ul>
            <li>
              Nicht-Cookie-Speicherung: nein
            </li>
          </ul>
        </div>
      </div>
    `
  },
  oneSignal: {
    name: 'OneSignal',
    category: 'functional',
    lastUpdated: '2023-08-21T00:00:00.000Z',
    description: `
      <div>
        <div>
          <div>Beschreibung des Services</div>
          <div>Dies ist ein Web-Push-Benachrichtigungsdienst.</div>
        </div>
        <div>
          <div>Verarbeitendes Unternehmen</div>
          <div>OneSignal.<br />411 Borel Ave Suite 512, CA 94402 San Mateo, United States of America</div>
        </div>
        <div>
          <div>Datenschutzbeauftragter des verarbeitenden Unternehmens</div>
          <div>Nachfolgend finden Sie die E-Mail-Adresse des Datenschutzbeauftragten des verarbeitenden Unternehmens.</div>
          <a tabindex="0" href="mailto: privacy@OneSignal.com" target="_blank" rel="noopener"> privacy@OneSignal.com</a></div>
        <div>
          <div>Zweck der Daten</div>
          <div>Diese Liste stellt die Zwecke der Datenerhebung und -verarbeitung dar.</div>
          <ul class="boxes">
            <li>Targeting</li>
            <li>Analyse</li>
            <li>Marketing</li>
            <li>Funktionalit&auml;t</li>
          </ul>
        </div>
        <div>
          <div>Genutzte Technologien</div>
          <div>In dieser Liste sind alle Technologien aufgef&uuml;hrt, die dieser Dienst zur Datenerfassung verwendet.</div>
          <ul class="boxes">
            <li>Cookies</li>
            <li>Pixel-Tags</li>
            <li>Web beacons</li>
          </ul>
        </div>
        <div>
          <div>Gesammelte Daten</div>
          <div>Diese Liste enth&auml;lt alle (pers&ouml;nlichen) Daten, die von oder durch die Nutzung dieses Dienstes gesammelt werden.</div>
          <ul class="boxes">
            <li>Ger&auml;teinformationen</li>
            <li>Sitzungsdauer</li>
            <li>IP-Adresse</li>
            <li>Zeitzone</li>
            <li>Geografischer Standort</li>
            <li>Nutzungsdaten</li>
            <li>Referrer URL</li>
            <li>Browserinformationen</li>
            <li>Zeitstempel</li>
            <li>Cookie ID</li>
            <li>Internetanbieter</li>
            <li>Ger&auml;tetyp</li>
          </ul>
        </div>
        <div>
          <div>Rechtliche Grundlage</div>
          <div>Im Folgenden wird die erforderliche Rechtsgrundlage f&uuml;r die Verarbeitung von Daten genannt</div>
          <ul class="boxes">
            <li>Art. 6 Abs. 1 S. 1 lit. a DSGVO</li>
          </ul>
        </div>
        <div>
          <div>Ort der Verarbeitung</div>
          <div>Dies ist der prim&auml;re Ort, an dem die gesammelten Daten verarbeitet werden. Sollten die Daten auch in anderen L&auml;ndern verarbeitet werden, werden Sie gesondert informiert.</div>
          <ul>
            <li>
              <div>Vereinigte Staaten von Amerika</div>
            </li>
          </ul>
        </div>
        <div>
          <div>Aufbewahrungsdauer</div>
          <div>Die Aufbewahrungsdauer ist die Zeitspanne, in der die gesammelten Daten f&uuml;r die Verarbeitung gespeichert werden. Die Daten m&uuml;ssen gel&ouml;scht werden, sobald sie f&uuml;r die angegebenen Verarbeitungszwecke nicht mehr ben&ouml;tigt werden.</div>
          <ul>
            <li>
              <div>Die Daten werden so lange aufbewahrt, wie es zur Erf&uuml;llung des/der Zwecks/Zwecke, f&uuml;r den/die sie erhoben wurden, erforderlich ist.</div>
            </li>
          </ul>
        </div>
        <div>
          <div>Datenempf&auml;nger</div>
          <div>Im Folgenden werden die Empf&auml;nger der erhobenen Daten aufgelistet.</div>
          <ul class="boxes">
            <li>OneSignal</li>
          </ul>
        </div>
        <div>
          <div>Klicken Sie hier, um die Datenschutzbestimmungen des Datenverarbeiters zu lesen.</div>
          <a tabindex="0" href="https://onesignal.com/privacy_policy" target="_blank" rel="noopener">https://onesignal.com/privacy_policy</a></div>
        <div>
          <div>Klicken Sie hier, um die Cookie-Richtlinie des Datenverarbeiters zu lesen.</div>
          <a tabindex="0" href="https://onesignal.com/privacy_policy" target="_blank" rel="noopener" data-testid="uc-settings-cookie-link">https://onesignal.com/privacy_policy</a></div>
        <div>
      </div>
    `
  }
}

Parse.Cloud.beforeSave(CookieConsent, async ({ object: cookieConsent }) => {
  await ensureUniqueField(cookieConsent, ['user', 'uuid'])
})

function getCurrentFromActivity (activity = {}) {
  const current = {}
  for (const key of Object.keys(activity)) {
    const lastActivity = activity[key][0]
    const lastUpdate = SERVICES[key].lastUpdated
    current[key] = lastActivity?.consent
      ? moment(lastActivity.date).isAfter(lastUpdate)
      : false
  }
  return current
}

Parse.Cloud.afterFind(CookieConsent, async ({ objects }) => {
  for (const cookieConsent of objects) {
    cookieConsent.set('current', getCurrentFromActivity(cookieConsent.get('activity')))
  }
})

Parse.Cloud.define('cookie-consent', async ({ params: { consentId, update }, user }) => {
  const query = $query(CookieConsent)
  user ? query.equalTo('user', user) : query.equalTo('uuid', consentId)
  const cookieConsent = await query.first({ useMasterKey: true }) || new CookieConsent({ user })
  cookieConsent.isNew() && await cookieConsent.set('uuid', uuidv4()).save(null, { useMasterKey: true })
  if (update) {
    const current = cookieConsent.get('current') || {}
    const activity = cookieConsent.get('activity') || {}
    let changed
    for (const key in update) {
      if (Boolean(current[key]) !== Boolean(update[key])) {
        if (!activity[key]) { activity[key] = [] }
        activity[key].push({ date: new Date().toISOString(), consent: Boolean(update[key]) })
        activity[key].sort((a, b) => b.date > a.date ? 1 : -1)
        changed = true
      }
    }
    if (changed) {
      cookieConsent.set('activity', activity)
      await cookieConsent.save(null, { useMasterKey: true })
    }
    cookieConsent.set('current', getCurrentFromActivity(activity))
  }
  const response = { consent: cookieConsent.toJSON() }
  if (!update) {
    response.services = SERVICES
  }
  return response
})
