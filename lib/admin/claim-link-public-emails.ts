/**
 * Public business contact addresses checked on 2026-10-08. Keyed by the Medusa
 * seller ID, never by a name: prospect names repeat and some retired preview
 * shops still have mirror rows. Add an address only when its cited page clearly
 * belongs to this business. The leads workbook has no email column.
 */
const PUBLIC_EMAILS: Record<string, { email: string; source: string }> = {
  sel_01M0JCG9K9CV1G7HHFKYV2A5X7: { email: 'info@180grados.mx', source: 'https://www.180grados.mx/en/pages/directorio' },
  sel_01M0HCS0RXRCEW5ZNXY7GV2HEB: { email: 'info@curatedbasics.com', source: 'https://www.curatedbasics.com/pages/about-us' },
  sel_01M0HCRXWTHYTQD2V3XX9451DN: { email: 'concretegardencandles@gmail.com', source: 'https://concretegardencandles.com/policies/refund-policy' },
  sel_01KW2RSY4RXB7Y6EGCEK4TMCNP: { email: 'globalcomicscondesa@gmail.com', source: 'https://www.globalcomics.com.mx/contactus' },
  sel_01KW2RQE1ZD8WPS7JCTMR13691: { email: 'infoeljugadornumero12@gmail.com', source: 'https://www.elnumero12.com/pages/contactanos' },
  sel_01KTQY8KXD9W3VFYR3XSXHN1E4: { email: 'contacto@teatrounam.com.mx', source: 'https://teatrounam.com.mx/teatro/entradasteatro/nuestro-equipo/' },
  sel_01KTQX0T7JX1QJRYVP8EMBC4X2: { email: 'borola_roma@outlook.com', source: 'https://www.tripadvisor.com.mx/Restaurant_Review-g150800-d12291525-Reviews-Borola_Cafe_Roma_Norte-Mexico_City_Central_Mexico_and_Gulf_Coast.html' },
  sel_01KTRRWHQHWM7BTP237SXPZ6BZ: { email: 'sofiaweidner@gmail.com', source: 'https://www.sofiaweidner.com/info' },
  sel_01M0JCJ6KSVDECC2N5WX59TR95: { email: 'errevintage@gmail.com', source: 'https://www.takethatjourney.com/products/detail/errevintage' },
  sel_01M0JCJBMQJRMFEWSAZ4S44BN8: { email: 'mobiliario.piezas.unicas@gmail.com', source: 'https://www.allbiz.mx/piezas-unicas-55-5276-5611' },
}

export function publicClaimLinkEmail(sellerId: string): string {
  return PUBLIC_EMAILS[sellerId]?.email ?? ''
}
