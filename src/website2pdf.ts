#!/usr/bin/env node
/* eslint-disable @typescript-eslint/no-explicit-any*/
import 'reflect-metadata';
import * as path from 'path';
import * as fs from 'fs-extra';
import * as puppeteer from 'puppeteer';
import {URL} from 'url';
import {red} from 'kleur';
import {logger} from './utils/logger';
import {Website} from './model/website';
import {headerFactory} from './utils/helpers';
import {PdfTemplate} from './model/pdfTemplate';
import {Website2PdfCli} from './cli/website2pdfCli';
import {ICliArguments} from './cli/iArgumentsParser';
import {WebsiteSitemap} from './model/websiteSitemap';
import {PrintResults, STATUS_PRINTED, STATUS_ERROR} from './utils/stats';

export class Website2Pdf {
  static main(): Promise<void> {
    return new Website2PdfCli().parse().then(cliArgs => {
      headerFactory();
      const website = new Website(cliArgs);
      return website.build().then((website: Website) => {
        if (website.sitemaps.length !== 0) {
          return processSitemaps(cliArgs, website);
        } else {
          logger().warn(
            `No sitemap found. Please check ${website.websiteURL.sitemapURL}`
          );
          return Promise.resolve();
        }
      });
    });
  }
}

Website2Pdf.main().catch((error: Error) => {
  logger().error(red(`${error.message}`));
  logger().debug(error);
});

function processSitemaps(
  cliArgs: ICliArguments,
  website: Website
): Promise<void> {
  return puppeteer.launch().then(browser => {
    browser.version().then(version => {
      logger().debug(`Starting browser instance: ${version}`);
    });
    return browser
      .createIncognitoBrowserContext()
      .then(browserContext => {
        logger().debug(
          `Creating incognito browser context: ${browserContext.isIncognito()}`
        );
        return Promise.all(
          website.sitemaps.map(sitemap => {
            if (sitemap.urls.length !== 0) {
              const outputDir = path.normalize(
                path.join(cliArgs.outputDir.toString(), sitemap.lang)
              );
              return processSitemap(
                browserContext,
                cliArgs,
                outputDir,
                sitemap,
                website.pdfTemplate
              );
            } else {
              logger().warn(
                `No URLs found for sitemap ${sitemap.lang}. Please check ${website.websiteURL}`
              );
              return Promise.resolve();
            }
          })
        ).then(() => {
          return Promise.resolve();
        });
      })
      .finally(() => {
        PrintResults.printResults();
        return browser.close();
      });
  });
}

function processSitemap(
  browserContext: puppeteer.BrowserContext,
  cliArgs: ICliArguments,
  outputDir: string,
  sitemap: WebsiteSitemap,
  pdfTemplate: PdfTemplate
): Promise<void> {
  return fs
    .ensureDir(outputDir)
    .then((result: any) => {
      result
        ? logger().debug(`Directory ${result} created`)
        : logger().debug(`Directory ${outputDir} already exists`);
    })
    .then(() => {
      logger().info(`Printing ${sitemap.urls.length} PDF(s) to ${outputDir}`);
      return Promise.all(
        sitemap.urls.map(url => {
          return printToPDF(
            browserContext,
            cliArgs,
            outputDir,
            url,
            pdfTemplate
          );
        })
      ).then(() => {
        return Promise.resolve();
      });
    });
}

function printToPDF(
  browserContext: puppeteer.BrowserContext,
  cliArgs: ICliArguments,
  outputDir: string,
  url: URL,
  pdfTemplate: PdfTemplate
): Promise<void> {
  return browserContext.newPage().then(page => {
    return page
      .goto(url.toString(), {waitUntil: 'networkidle2'})
      .then(() => {
        return page.title();
      })
      .then(title => {
        const filePath = path.join(outputDir, `${toFilename(title)}.pdf`);
        logger().debug(`Printing page "${filePath}" from url "${url}"`);
        return page
          .pdf({
            timeout: 0,
            path: filePath,
            format: 'a4',
            displayHeaderFooter: cliArgs.displayHeaderFooter,
            headerTemplate: pdfTemplate.header,
            footerTemplate: pdfTemplate.footer,
            margin: {top: '40px', bottom: '40px', left: '40px', right: '40px'},
            printBackground: true,
          })
          .then(() => {
            PrintResults.storeResult(url, filePath, STATUS_PRINTED);
            return Promise.resolve();
          })
          .catch((error: Error) => {
            PrintResults.storeResult(url, filePath, STATUS_ERROR);
            throw error;
          });
      })
      .finally(() => {
        return page.close();
      });
  });
}

function toFilename(title: string): string {
  return title
    .replace(/[^a-z0-9\u00C0-\u024F\u1E00-\u1EFF]/gi, ' ')
    .trim()
    .replace(/ /g, '_')
    .replace(/([_])\1+/g, '_');
}
