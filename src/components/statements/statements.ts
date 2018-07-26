import moment from 'moment';

import { BillingClient } from '../../lib/billing';
import CloudFoundryClient from '../../lib/cf';
import { ISpace } from '../../lib/cf/types';
import { IParameters, IResponse, NotFoundError } from '../../lib/router';

import { IContext } from '../app/context';
import {
  CLOUD_CONTROLLER_ADMIN,
  CLOUD_CONTROLLER_GLOBAL_AUDITOR,
  CLOUD_CONTROLLER_READ_ONLY_ADMIN,
} from '../auth';

import usageTemplate from './statements.njk';
import { space } from '../../lib/cf/cf.test.data';

interface IResourceUsage {
  readonly resourceGUID: string;
  readonly resourceName: string;
  readonly resourceType: string;
  readonly orgGUID: string;
  readonly spaceGUID: string;
  readonly space?: ISpace;
  readonly planGUID: string;
  readonly planName: string;
  readonly price: {
    incVAT: number;
    exVAT: number;
  };
}

interface IResourceGroup {
  readonly [key: string]: IResourceUsage;
}

const YYYMMDD = 'YYYY-MM-DD';

export async function statementRedirection(ctx: IContext, params: IParameters): Promise<IResponse> {
  const date = params.rangeStart ? moment(params.rangeStart) : moment();

  return {
    redirect: ctx.linkTo('admin.statement.view', {
      organizationGUID: params.organizationGUID,
      rangeStart: date.startOf('month').format(YYYMMDD)
    }),
  };
}

export async function viewStatement(ctx: IContext, params: IParameters): Promise<IResponse> {
  const rangeStart = moment(params.rangeStart, YYYMMDD);
  const selectedSpace = params.space ? params.space : 'All spaces';
  const selectedPlan = params.services ? params.services : 'All services';
  console.log('params', params);
  if (!rangeStart.isValid()) {
    throw new Error('invalid rangeStart provided');
  }

  if (rangeStart.date() > 1) {
    throw new Error('expected rangeStart to be the first of the month');
  }

  const currentMonth = rangeStart.format('MMMM');

  const cf = new CloudFoundryClient({
    accessToken: ctx.token.accessToken,
    apiEndpoint: ctx.app.cloudFoundryAPI,
  });

  const isAdmin = ctx.token.hasAnyScope(
    CLOUD_CONTROLLER_ADMIN,
    CLOUD_CONTROLLER_READ_ONLY_ADMIN,
    CLOUD_CONTROLLER_GLOBAL_AUDITOR,
  );
  const isManager = await cf.hasOrganizationRole(params.organizationGUID, ctx.token.userID, 'org_manager');
  const isBillingManager = await cf.hasOrganizationRole(params.organizationGUID, ctx.token.userID, 'billing_manager');

  /* istanbul ignore next */
  if (!isAdmin && !isManager && !isBillingManager) {
    throw new NotFoundError('not found');
  }

  const organization = await cf.organization(params.organizationGUID);
  const spaces = await cf.spaces(params.organizationGUID);

  const billingClient = new BillingClient({
    apiEndpoint: ctx.app.billingAPI,
    accessToken: ctx.token.accessToken,
  });

  const filter = {
    rangeStart: rangeStart.toDate(),
    rangeStop: rangeStart.add(1, 'month').toDate(),
    orgGUIDs: [organization.metadata.guid],
  };

  const events = await billingClient.getBillableEvents(filter);

  /* istanbul ignore next */
  const cleanEvents = events.map(ev => ({
    ...ev,
    resourceName: /__conduit_\d+__/.test(ev.resourceName) ?
      'conduit-tunnel' : ev.resourceName,
  }));

  let usdExchangeRate: number = 1;

  /* istanbul ignore next */
  const itemsObject: IResourceGroup = cleanEvents.reduce((resources: IResourceGroup, event: IBillableEvent) => {
    const key = [event.orgGUID, event.spaceGUID, event.planGUID, event.resourceName].join(':');
    const {[key]: resource, ...rest} = resources;

    event.price.details.forEach(detail => {
      if (detail.currencyCode === 'USD') {
        usdExchangeRate = detail.currencyRate;
      }
    });

    if (!resource) {
      return {...rest, [key]: {
        ...event,
        planName: event.price.details.map(pc => pc.planName.replace('Free', 'micro'))
          .find(name => name !== '') || 'unknown',
        space: spaces.find(s => s.metadata.guid === event.spaceGUID),
      }};
    }

    const {price, ...resourceFields} = resource;
    return {...rest, [key]: {
      ...resourceFields,
      price: {
        exVAT: price.exVAT + event.price.exVAT,
        incVAT: price.incVAT + event.price.incVAT,
      },
    }};
  }, {});

  let items = Object.values(itemsObject);

  /* istanbul ignore next */
  const totals = {
    incVAT: events.reduce((sum, event) => sum + event.price.incVAT, 0),
    exVAT: events.reduce((sum, event) => sum + event.price.exVAT, 0),
  };

  const listOfPastYearMonths: {[i: string]: string} = {};

  for (let i = 0; i < 12; i++) {
    const month = moment().subtract(i, 'month').startOf('month');

    listOfPastYearMonths[month.format(YYYMMDD)] = `${month.format('MMMM')} ${month.format('YYYY')}`;
  }

  let tempArray: any = [];

  const spacesAll = items.filter(item => {
    if (!tempArray.includes(item.spaceGUID)) {
      tempArray.push(item.spaceGUID);
      return true;
    }
  }).map(item => {
      return { spaceGUID: item.spaceGUID, name: item.space.entity.name };
  });

  function compare(a: any, b: any) {
    if (a.name < b.name) {
      return -1;
    }
    if (a.name > b.name) {
      return 1;
    }
    return 0;
  }

  const spaceDefault = { spaceGUID: 'none', name: 'All spaces' };
  spacesAll.sort(compare);
  spacesAll.unshift(spaceDefault);

  let selectedSpaceAll: any = spacesAll.filter(spaceItem => {
    return spaceItem.spaceGUID === selectedSpace;
  });

  selectedSpaceAll = selectedSpaceAll[0] ? selectedSpaceAll[0] : spaceDefault;

  const filterSpaces = items.filter(item => {
    if (selectedSpaceAll.spaceGUID === 'none') {
      return item;
    } else {
      if (selectedSpaceAll.spaceGUID === item.spaceGUID){
        return item;
    }
  });

  items = filterSpaces;

  ////Plans
  tempArray = [];
  const plans = items.filter(item => {
    if (!tempArray.includes(item.planGUID)) {
      tempArray.push(item.planGUID);
      return true;
    }
  }).map(item => {
    return { planGUID: item.planGUID, name: item.planName };
  });

  const planDefault = { planGUID: 'none', name: 'All services' };
  plans.sort(compare);
  plans.unshift(planDefault);

  let selectedPlanAll: any = plans.filter(planItem => {
    return planItem.planGUID === selectedPlan;
  });

  selectedPlanAll = selectedPlanAll[0] ? selectedPlanAll[0] : planDefault;

  const filterPlans = items.filter(item => {
    if (selectedPlanAll.planGUID === 'none') {
      return item;
    } else {
      if (plans.planGUID === item.planGUID) {
        return item;
      }
    });

  //items = filterPlans
  //console.log('filterplans', filterPlans);
  //console.log('items', items, 'plans', plans);

  return { body: usageTemplate.render({
      routePartOf: ctx.routePartOf,
      linkTo: ctx.linkTo,
      organization,
      filter,
      totals,
      items,
      spacesAll,
      plans,
      usdExchangeRate,
      isCurrentMonth:
        Object.keys(listOfPastYearMonths)[0] === params.rangeStart,
      listOfPastYearMonths,
      selectedMonth: params.rangeStart,
      selectedSpaceAll,
      selectedPlanAll,
      currentMonth,
      isAdmin,
      isBillingManager,
      isManager,
    }) };
}
