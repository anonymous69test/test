import * as zendesk from 'node-zendesk';
import React from 'react';

import { Template } from '../../layouts';
import { IParameters, IResponse } from '../../lib/router';
import { IContext } from '../app';
import { IValidationError } from '../errors/types';

import UAAClient from '../../lib/uaa';
import { Token } from '../auth';

import {
  ContactUsPage,
  DocumentsCrownMoU,
  DocumentsNonCrownMoU,
  FindOutMorePage,
  HelpUsingPaasPage,
  IContactUsFormValues,
  IFindOutMoreFormValues,
  IHelpUsingPaasFormValues,
  ISomethingWrongWithServiceFormValues,
  ISupportSelectionFormValues,
  SomethingWrongWithServicePage,
  StaticIPs,
  SupportConfirmationPage,
  supportFormFieldsText,
  SupportSelectionPage,
} from './views';
import CloudFoundryClient from '../../lib/cf';

interface IUserTypedRequester {
  readonly email: string;
  readonly name: string;
}

interface ISupportFormName {
  readonly name?: string;
}

interface ISupportFormEmail {
  readonly email?: string;
}

interface ISupportFormMessage {
  readonly message?: string;
}

interface ISupportFormGovOrgName {
  readonly gov_organisation_name?: string;
}

interface ISupportFormDeptAgency {
  readonly department_agency?: string;
}
interface ISupportFormServiceTeam {
  readonly service_team?: string;
}

interface ISomethingWrongWithServiceForm extends ISomethingWrongWithServiceFormValues {
  readonly values?: ISomethingWrongWithServiceFormValues;
}

interface IHelpUsingPaasForm extends IHelpUsingPaasFormValues {
  readonly values?: IHelpUsingPaasFormValues;
}

interface IFindOutMoreForm extends IFindOutMoreFormValues {
  readonly values?: IFindOutMoreFormValues;
}

interface IContactUsForm extends IContactUsFormValues {
  readonly values?: IContactUsFormValues;
}

export interface IRequesterDetails {
  readonly region?: string;
  readonly acc_email?: string;
  readonly roles?: ReadonlyArray<{
    readonly orgGuid: string;
    readonly orgName: string;
    readonly roleType: string;
  }>
}

const VALID_EMAIL = /[^.]@[^.]/;

const TODAY_DATE = new Date();

export async function fetchRequesterDetailsAndRoles(ctx: IContext): Promise<IRequesterDetails> {
  // if user not logged in, bail and return empty object
  const userLoggedIn =  ctx.session.passport?.user;
  if (userLoggedIn === undefined ) return {};

  const uaa = new UAAClient({
    apiEndpoint: ctx.app.uaaAPI,
    clientCredentials: {
      clientID: ctx.app.oauthClientID,
      clientSecret: ctx.app.oauthClientSecret,
    },
  });

  const signingKeys = await uaa.getSigningKeys();
  const token = new Token(ctx.session.passport.user, signingKeys);
  const cf = new CloudFoundryClient({
    accessToken: token.accessToken,
    apiEndpoint: ctx.app.cloudFoundryAPI,
    logger: ctx.app.logger,
  });
  const region = (ctx.app.location).toLowerCase();
  // get user from UAA
  const user = await uaa.getUser(token.userID);
  // get their roles
  const roles = await cf.userRoles(user!.id);
  // fetch org details and roles the user has 
  const userRoleTypeAndOrg = await Promise.all(
    roles
    .filter(r => r.relationships.organization.data)
    .map(async r => ({
      // data will contain the GUID string
      orgGuid: r.relationships.organization.data.guid!,
      orgName: ((await cf.organization(r.relationships.organization.data.guid!)).entity.name),
      roleType: r.type,
    }),
  ))
  // contruct a new object with details
  const requesterDetails = {
    acc_email: user!.emails[0].value,
    region: region,
    roles: userRoleTypeAndOrg,
  };

  return requesterDetails;
}

export function requesterDetailsContent (variables: IRequesterDetails): string {
  if (Object.entries(variables).length === 0) {
    return 'Requester not logged in';
  } else {
    return `
      Account email address: ${variables.acc_email}
      Roles:
      ${variables.roles && variables.roles.length ? variables.roles!.map(r => (
      `Role of ${r.roleType} in ${r.orgName}: https://admin.${variables.region === 'london'? 'london.' : ''}cloud.service.gov.uk/organisations/${r.orgGuid}`
      )).join('\n') : 'No organisation roles found'}`;
  }
}

// abstraction so we don't have to repeat the same zendesk client code across all
async function createAndUpdateZendeskTicket(
    ctx: IContext, 
    bodyContent: string,
    body: IUserTypedRequester,
    ticketTitle: string,
    ticketTags?: ReadonlyArray<string>,
  ): Promise<void> {
  const requesterDetails:IRequesterDetails = await fetchRequesterDetailsAndRoles(ctx);
  const client = zendesk.createClient(ctx.app.zendeskConfig);

  await client.tickets.create({
    ticket: {
      comment: {
        body: bodyContent,
      },
      subject: ticketTitle,
      requester: {
        email: body.email,
        name: body.name,
      },
      tags: ticketTags,
    },
  })
  .then(async result => {
    await client.tickets.update(result.id,{
      ticket: {
        comment: {
          body: requesterDetailsContent(requesterDetails),
          public: false,
        },
      },
    });
  });
}

function findoutMoreContent(variables: IFindOutMoreFormValues): string {

  return `
    ${supportFormFieldsText.name}: ${variables.name}
    ${supportFormFieldsText.email_address}: ${variables.email}

    My ${supportFormFieldsText.gov_organisation_name}: ${variables.gov_organisation_name}
    
    ${supportFormFieldsText.message}:
    ${variables.message}
  `;
}

function somethingWrongWithServiceContent(variables: ISomethingWrongWithServiceFormValues): string {
  let severityLevel
  switch(variables.impact_severity) {
    case("service_down"):
      severityLevel = supportFormFieldsText.severity.service_down
    break;
    case("service_downgraded"):
      severityLevel = supportFormFieldsText.severity.service_downgraded
    break;
    case("cannot_operate_live"):
      severityLevel = supportFormFieldsText.severity.cannot_operate_live
    break;
    case("cannot_operate_dev"):
      severityLevel = supportFormFieldsText.severity.cannot_operate_dev
    break;
    default:
      severityLevel = supportFormFieldsText.severity.other
  }

  return `
    ${supportFormFieldsText.name}: ${variables.name}
    ${supportFormFieldsText.email_address}: ${variables.email}

    ${supportFormFieldsText.affected_paas_organisation}: ${variables.affected_paas_organisation}

    ${supportFormFieldsText.severity.heading}
    ${severityLevel}

    ${supportFormFieldsText.message}:
    ${variables.message}
  `;
}

function helpUsingPaasContent(variables: IHelpUsingPaasFormValues): string {

  return `
    ${supportFormFieldsText.name}: ${variables.name}
    ${supportFormFieldsText.email_address}: ${variables.email}
    ${supportFormFieldsText.optional_paas_organisation}: ${variables.paas_organisation_name ? variables.paas_organisation_name : 'not provided'}
    ${supportFormFieldsText.message}:
    ${variables.message}
  `;
}

function contactUsContent(variables: IContactUsFormValues): string {

  return `
    ${supportFormFieldsText.name}: ${variables.name}
    ${supportFormFieldsText.email_address}: ${variables.email}

    ${supportFormFieldsText.department_agency} I work for: ${variables.department_agency}
    ${supportFormFieldsText.service_team} I work on: ${variables.service_team}
    
    ${supportFormFieldsText.message}:
    ${variables.message}
  `;
}

function validateSupportSelection({ support_type }: ISupportSelectionFormValues): ReadonlyArray<IValidationError> {
  const errors = [];

  if (!support_type) {
    errors.push({
      field: 'support_type',
      message: 'Select which type of support your require',
    });
  }

  return errors;
}

function validateName({ name }: ISupportFormName): ReadonlyArray<IValidationError> {
  const errors = [];

  if (!name) {
    errors.push({
      field: 'name',
      message: 'Enter your full name',
    });
  }

  return errors;
}

function validateEmail({ email }: ISupportFormEmail): ReadonlyArray<IValidationError> {
  const errors = [];

  if (!email || !VALID_EMAIL.test(email)) {
    errors.push({
      field: 'email',
      message: 'Enter an email address in the correct format, like name@example.com',
    });
  }

  return errors;
}

function validateMessage({ message }: ISupportFormMessage): ReadonlyArray<IValidationError> {
  const errors = [];

  if (!message) {
    errors.push({
      field: 'message',
      message: 'Enter your message',
    });
  }

  return errors;
}

function validateAffectedOrg(
  { affected_paas_organisation }: ISomethingWrongWithServiceForm,
): ReadonlyArray<IValidationError> {
  const errors = [];

  if (!affected_paas_organisation) {
    errors.push({
      field: 'affected_paas_organisation',
      message: 'Enter the name of the affected organisation',
    });
  }

  return errors;
}

function validateImpactSeverity({ impact_severity }: ISomethingWrongWithServiceForm): ReadonlyArray<IValidationError> {
  const errors = [];

  if (!impact_severity) {
    errors.push({
      field: 'impact_severity',
      message: 'Select the severity of the impact',
    });
  }

  return errors;
}

function validateGovOrg({ gov_organisation_name }: ISupportFormGovOrgName): ReadonlyArray<IValidationError> {
  const errors = [];

  if (!gov_organisation_name) {
    errors.push({
      field: 'gov_organisation_name',
      message: 'Enter your government organisation’s name',
    });
  }

  return errors;
}

function validateDepartmentAgency({ department_agency }: ISupportFormDeptAgency): ReadonlyArray<IValidationError> {
  const errors = [];

  if (!department_agency) {
    errors.push({
      field: 'department_agency',
      message: 'Enter your department or agency',
    });
  }

  return errors;
}

function validateServiceTeam({ service_team }: ISupportFormServiceTeam): ReadonlyArray<IValidationError> {
  const errors = [];

  if (!service_team) {
    errors.push({
      field: 'service_team',
      message: 'Enter your service or team',
    });
  }

  return errors;
}

export async function SupportSelectionForm (ctx: IContext, _params: IParameters): Promise<IResponse> {

  const template = new Template(ctx.viewContext, 'Get support');

  return await Promise.resolve({
    body: template.render(<SupportSelectionPage
      csrf={ctx.viewContext.csrf}
      linkTo={ctx.linkTo}
    />),
  });
}

export async function HandleSupportSelectionFormPost (
  ctx: IContext,
  _params: IParameters,
  body: ISupportSelectionFormValues,
): Promise<IResponse> {
  const errors = [];
  const template = new Template(ctx.viewContext);

  errors.push(
    ...validateSupportSelection(body),
  );

  if (errors.length > 0) {
    template.title = 'Error: Get support';

    return await Promise.resolve({
      body: template.render(<SupportSelectionPage
        csrf={ctx.viewContext.csrf}
        errors={errors}
        linkTo={ctx.linkTo}
        values={body}
      />),
      status: 400,
    });
  }

  return await Promise.resolve({
    body: template.render(<SupportSelectionPage
      csrf={ctx.viewContext.csrf}
      linkTo={ctx.linkTo}
      values={body}
    />),
  });
}

export async function SomethingWrongWithServiceForm (ctx: IContext): Promise<IResponse> {

  const template = new Template(ctx.viewContext, 'Something’s wrong with my live service');

  return await Promise.resolve({
    body: template.render(<SomethingWrongWithServicePage
      csrf={ctx.viewContext.csrf}
      linkTo={ctx.linkTo}
    />),
  });
}

export async function HandleSomethingWrongWithServiceFormPost(
  ctx: IContext,
  _params: IParameters,
  body: ISomethingWrongWithServiceForm,
): Promise<IResponse> {
  const errors = [];
  const template = new Template(ctx.viewContext);

  errors.push(
    ...validateName(body),
    ...validateEmail(body),
    ...validateAffectedOrg(body),
    ...validateImpactSeverity(body),
    ...validateMessage(body),
    );
  if (errors.length > 0) {
    template.title = 'Error: Something’s wrong with my live service';

    return {
      body: template.render(<SomethingWrongWithServicePage
        csrf={ctx.viewContext.csrf}
        linkTo={ctx.linkTo}
        errors={errors}
        values={body}
      />),
      status: 400,
    };
  }

  let subject = ""
  const urgentSeverities = ["service_down", "service_downgraded", "cannot_operate_live"]
  if(urgentSeverities.includes(body.impact_severity)) {
    subject = `[PaaS Support] URGENT: ${body.impact_severity} for ${body.affected_paas_organisation} at ${TODAY_DATE.toDateString()}`;
  } else {
    subject = `[PaaS Support] ${TODAY_DATE.toDateString()} something wrong in ${body.affected_paas_organisation} live service`;
  }

  await createAndUpdateZendeskTicket(
    ctx,
    somethingWrongWithServiceContent({
      affected_paas_organisation: body.affected_paas_organisation,
      email: body.email,
      impact_severity: body.impact_severity,
      message: body.message,
      name: body.name,
    }),
    body,
    subject,
  );

  template.title = 'We have received your message';

  return {
    body: template.render(
      <SupportConfirmationPage
        linkTo={ctx.linkTo}
        heading={'We have received your message'}
        text={`We deal with the most critical issues first. During working hours we will start investigating critical
          issues within 20 minutes.`}
      >
      Outside of working hours we support critical issues only, and we aim to start working on the issue within
      40 minutes.<br />
      If the issue is not impacting your service, we aim to start working on your request within 1 business day.<br />
      Read more about our{' '}
        <a className="govuk-link"
          href="https://www.cloud.service.gov.uk/support-and-response-times">
            support and resolution times
        </a>.
      </SupportConfirmationPage>,
    ),
  };
}

export async function HelpUsingPaasForm (ctx: IContext): Promise<IResponse> {

  const template = new Template(ctx.viewContext, 'I need some help using GOV.UK PaaS');

  return await Promise.resolve({
    body: template.render(<HelpUsingPaasPage
      csrf={ctx.viewContext.csrf}
      linkTo={ctx.linkTo}
    />),
  });
}

export async function HandleHelpUsingPaasFormPost(
  ctx: IContext,
  _params: IParameters,
  body: IHelpUsingPaasForm,
): Promise<IResponse> {
  const errors = [];
  const template = new Template(ctx.viewContext);

  errors.push(
    ...validateName(body),
    ...validateEmail(body),
    ...validateMessage(body));
  if (errors.length > 0) {
    template.title = 'Error: I need some help using GOV.UK PaaS';

    return {
      body: template.render(<HelpUsingPaasPage
        csrf={ctx.viewContext.csrf}
        linkTo={ctx.linkTo}
        errors={errors}
        values={body}
      />),
      status: 400,
    };
  }

 await createAndUpdateZendeskTicket(
  ctx,
  helpUsingPaasContent({
    email: body.email,
    message: body.message,
    name: body.name,
    paas_organisation_name: body.paas_organisation_name,
  }),
  body,
  `[PaaS Support] ${TODAY_DATE.toDateString()} request for help`,
 );

  template.title = 'We have received your message';

  return {
    body: template.render(
      <SupportConfirmationPage
        linkTo={ctx.linkTo}
        heading={'We have received your message'}
        text={'We try to reply to all queries by the end of the next working day.'}
      >
        Read more about our{' '}
        <a className="govuk-link"
          href="https://www.cloud.service.gov.uk/support-and-response-times">
            support and resolution times
        </a>.
      </SupportConfirmationPage>,
    ),
  };
}

export async function FindOutMoreForm (ctx: IContext): Promise<IResponse> {

  const template = new Template(ctx.viewContext, 'I’d like to find out more about GOV.UK PaaS');

  return await Promise.resolve({
    body: template.render(<FindOutMorePage
      csrf={ctx.viewContext.csrf}
      linkTo={ctx.linkTo}
    />),
  });
}

export async function HandleFindOutMoreFormPost (
  ctx: IContext,
  _params: IParameters,
  body: IFindOutMoreForm,
): Promise<IResponse> {
  const errors = [];
  const template = new Template(ctx.viewContext);
  errors.push(
    ...validateName(body),
    ...validateEmail(body),
    ...validateGovOrg(body),
    ...validateMessage(body),
  );

  if (errors.length > 0) {
    template.title = 'Error: I’d like to find out more about GOV.UK PaaS';

    return {
      body: template.render(<FindOutMorePage
        csrf={ctx.viewContext.csrf}
        linkTo={ctx.linkTo}
        errors={errors}
        values={body}
      />),
      status: 400,
    };
  }


  await createAndUpdateZendeskTicket(
    ctx,
    findoutMoreContent({
      email: body.email,
      gov_organisation_name: body.gov_organisation_name,
      message: body.message,
      name: body.name,
    }),
    body,
    `[PaaS Support] ${TODAY_DATE.toDateString()} request for information`,
  );

  template.title = 'We have received your message';

  return {
    body: template.render(
      <SupportConfirmationPage
        linkTo={ctx.linkTo}
        heading={'We have received your message'}
        text={`A member of our product team will be in touch. We try to reply to all queries by the end of the next
          working day.`}
      >
        Read more about our{' '}
        <a className="govuk-link"
          href="https://www.cloud.service.gov.uk/roadmap">
            roadmap and features
        </a>.
      </SupportConfirmationPage>,
    ),
  };
}

export async function ContactUsForm (ctx: IContext, _params: IParameters): Promise<IResponse> {

  const template = new Template(ctx.viewContext, 'Contact us');

  return await Promise.resolve({
    body: template.render(<ContactUsPage
      csrf={ctx.viewContext.csrf}
      linkTo={ctx.linkTo}
    />),
  });
}

export async function HandleContactUsFormPost(
  ctx: IContext,
  _params: IParameters,
  body: IContactUsForm,
): Promise<IResponse> {
  const errors = [];
  const template = new Template(ctx.viewContext);

  errors.push(
    ...validateName(body),
    ...validateEmail(body),
    ...validateDepartmentAgency(body),
    ...validateServiceTeam(body),
    ...validateMessage(body),
  );

  if (errors.length > 0) {
    template.title = 'Error: Contact us';

    return {
      body: template.render(<ContactUsPage
        csrf={ctx.viewContext.csrf}
        linkTo={ctx.linkTo}
        errors={errors}
        values={body}
      />),
      status: 400,
    };
  }

  await createAndUpdateZendeskTicket(
    ctx,
    contactUsContent({
      department_agency: body.department_agency,
      email: body.email,
      message: body.message,
      name: body.name,
      service_team: body.service_team,
    }),
    body,
    `[PaaS Support] ${TODAY_DATE.toDateString()} support request from website`,
  );

  template.title = 'We have received your message';

  return {
    body: template.render(
      <SupportConfirmationPage
        linkTo={ctx.linkTo}
        heading={'We have received your message'}
        text={'We will contact you on the next working day.'}
      >
        <a className="govuk-link"
          href="https://www.cloud.service.gov.uk/get-started">
            See the next steps to get started
        </a>.
      </SupportConfirmationPage>,
    ),
  };
}

export async function handleStaticIPs(ctx: IContext): Promise<IResponse> {
  const template = new Template(ctx.viewContext, 'GOV.UK PaaS Static IPs');

  return await Promise.resolve({
    body: template.render(<StaticIPs />),
  });
}

export async function handleCrownMoU(ctx: IContext): Promise<IResponse> {
  const template = new Template(ctx.viewContext, 'GOV.UK PaaS memorandum of understanding for Crown bodies');

  return await Promise.resolve({
    body: template.render(<DocumentsCrownMoU />),
  });
}

export async function handleNonCrownMoU(ctx: IContext): Promise<IResponse> {
  const template = new Template(ctx.viewContext, 'GOV.UK PaaS memorandum of understanding for non-Crown bodies');

  return await Promise.resolve({
    body: template.render(<DocumentsNonCrownMoU />),
  });
}
