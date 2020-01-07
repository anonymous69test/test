import React, { ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server'; // tslint:disable-line:no-submodule-imports

import { IViewContext } from '../components/app';
import { Footer, Header, Main, PhaseBanner } from './partials';

import govukPrintStyles from './govuk.print.scss';
import govukIE8Styles from './govuk.screen.ie8.scss';
import govukStyles from './govuk.screen.scss';

export class Template {
  private _language: string = 'en';

  constructor(private ctx: IViewContext, private _title: string) {
  }

  public render(page: ReactElement): string {
    const themeColor = '#0b0c0c';
    const assetPath = '/assets';
    const assetURL = 'https://admin.cloud.service.gov.uk/assets';

    return `<!DOCTYPE html>
    <html lang=${this._language} class="govuk-template">
        <head>
          <meta charSet="utf-8" />
          <title lang="${this._language}">${this._title}</title>
          <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
          <meta name="theme-color" content="${themeColor}" />
          <meta httpEquiv="X-UA-Compatible" content="IE=edge" />
          <meta name="csrf-token" content="${this.ctx.csrf}" />

          <link rel="shortcut icon" sizes="16x16 32x32 48x48" type="image/x-icon"
            href="${assetPath}/images/favicon.ico" />
          <link rel="mask-icon" color="${themeColor}"
            href="${assetPath}/images/govuk-mask-icon.svg" />
          <link rel="apple-touch-icon" sizes="180x180"
            href="${assetPath}/images/govuk-apple-touch-icon-180x180.png" />
          <link rel="apple-touch-icon" sizes="167x167"
            href="${assetPath}/images/govuk-apple-touch-icon-167x167.png" />
          <link rel="apple-touch-icon" sizes="152x152"
            href="${assetPath}/images/govuk-apple-touch-icon-152x152.png" />
          <link rel="apple-touch-icon"
            href="${assetPath}/images/govuk-apple-touch-icon.png" />

          <meta name="x-user-identity-origin" content="${this.ctx.origin || ''}" />

          <!--[if !IE 8]><!-->
            <link href="${govukStyles}" media="screen" rel="stylesheet" />
            <link href="${govukPrintStyles}" media="print" rel="stylesheet" type="text/css" />
          <!--<![endif]-->

          <!--[if IE 8]>
            <link href="${govukIE8Styles}" media="screen" rel="stylesheet" />
          <![endif]-->

          <!--[if lt IE 9]>
            <script src="/html5-shiv/html5shiv.js"></script>
          <![endif]-->

          <meta property="og:image" content="${assetURL}/images/govuk-opengraph-image.png" />
        </head>
        ${renderToStaticMarkup(<body className="govuk-template__body">
          <this.EnableClientSideJavaScript />

          <a href="#main-content" className="govuk-skip-link">Skip to main content</a>

          <Header location={this.ctx.location} isPlatformAdmin={!!this.ctx.isPlatformAdmin} />

          <div className="govuk-width-container">
            <PhaseBanner tag={{ text: 'beta' }}>
              <a className="govuk-link" href="https://www.cloud.service.gov.uk/support">
                Get support
              </a> or <a className="govuk-link" href="https://www.cloud.service.gov.uk/pricing">
                view our pricing
              </a>
            </PhaseBanner>
            <Main>
              {page}
            </Main>
          </div>

          <Footer />

          <script src={`${assetPath}/all.js`}></script>
          <script src={`${assetPath}/init.js`}></script>
        </body>)}
      </html>`;
  }

  private EnableClientSideJavaScript(): ReactElement {
    return (
      <script dangerouslySetInnerHTML={{
        __html: `document.body.className = ((document.body.className) ? document.body.className + ' js-enabled' : 'js-enabled');`,
      }}></script>
    );
  }
}
