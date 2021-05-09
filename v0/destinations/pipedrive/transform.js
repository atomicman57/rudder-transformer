/* eslint-disable no-nested-ternary */
/* eslint-disable prefer-const */
/* eslint-disable prettier/prettier */
/* eslint-disable camelcase */
const get = require("get-value");
const set = require("set-value");
const { EventType } = require("../../../constants");
const {
  constructPayload,
  extractCustomFields,
  defaultRequestConfig,
  removeUndefinedAndNullValues,
  defaultPostRequestConfig,
  defaultPutRequestConfig,
  getValueFromMessage,
  getFieldValueFromMessage,
  getDestinationExternalID,
  getErrorRespEvents,
  getSuccessRespEvents,
} = require("../../util");
const {
  getMergeEndpoint,
  groupDataMapping,
  trackDataMapping,
  PERSONS_ENDPOINT,
  PIPEDRIVE_GROUP_EXCLUSION,
  PIPEDRIVE_TRACK_EXCLUSION,
  LEADS_ENDPOINT,
} = require("./config");
const {
  createNewOrganisation,
  searchPersonByCustomId,
  searchOrganisationByCustomId,
  getFieldValueOrThrowError,
  updateOrganisationTraits,
  renameCustomFields,
  createPerson,
  extractPersonData,
  CustomError,
  mergeTwoPersons,
  searchPersonByPipedriveId
} = require("./util");

const identifyResponseBuilder = async (message, { Config }) => {
  // name is required field for destination payload
  
  const userIdToken = get(Config, "userIdToken");
  if (!userIdToken) {
    throw new CustomError("userId Token is required", 400);
  }

  const externalId = getDestinationExternalID(message, "pipedrivePersonId");
  let payload;

  if(externalId) {
    // if externalId provided, call update endpoint
    payload = extractPersonData(message, Config, ["traits", "context.traits"], true);
    set(payload, userIdToken, externalId.toString());

    const response = defaultRequestConfig();
    response.body.JSON = removeUndefinedAndNullValues(payload);
    response.method = defaultPutRequestConfig.requestMethod;
    response.headers = {
      "Content-Type": "application/json",
      Accept: "application/json"
    };
    response.endpoint = `${PERSONS_ENDPOINT}/${externalId}`;
    response.params = {
      api_token: Config.apiToken
    };

    return response;
  }

  const userId = getFieldValueFromMessage(message, "userIdOnly");
  if(!userId) {
    throw new CustomError("userId or pipedrivePersonId required", 400);
  }

  let payloadExtracted = false;
  let person = await searchPersonByCustomId(userId, Config);
  if(!person) {
    if(!Config.enableUserCreation) {
      throw new CustomError("person not found, and userCreation is turned off on dashboard", 400);
    }

    // identifyEvent=true, newUser=true(default)
    payload = extractPersonData(message, Config, ["traits", "context.traits"], true);

    const createPayload = {
      name: get(payload, "name"),
      [userIdToken]: userId,
      add_time: get(payload, "add_time")
    };
  
    person = await createPerson(createPayload, Config);
    if (!person) {
      throw new CustomError("Person could not be created in Pipedrive");
    }
    payloadExtracted = true;
  }

  if(!payloadExtracted) {
    // identifyEvent=true, newUser=false
    payload = extractPersonData(message, Config, ["traits", "context.traits"], true, false);
  } 

  delete payload.add_time;

  // update person from router
  const response = defaultRequestConfig();
  response.method = defaultPutRequestConfig.requestMethod;
  response.headers = {
    "Content-Type": "application/json",
    Accept: "application/json"
  };

  response.body.JSON = removeUndefinedAndNullValues(payload);
  response.endpoint = `${PERSONS_ENDPOINT}/${person.id}`;
  response.params = {
    api_token: Config.apiToken
  };

  return response;
};

const groupResponseBuilder = async (message, { Config }) => {
  
  if(!get(Config, "groupIdToken")) {
    throw new CustomError("groupIdToken token required", 400);
  }
  const groupId = getFieldValueOrThrowError(
    message,
    "groupId",
    new CustomError("groupId or pipedriveGroupId is required for group call", 400)
  );

  let userId;
  let groupPayload;
  let org;

  const externalGroupId = getDestinationExternalID(message, "pipedriveGroupId");
  const externalUserId = getDestinationExternalID(message, "pipedrivePersonId");

  // if(!externalGroupId) {
  //   groupId = getFieldValueOrThrowError(
  //     message,
  //     "groupId",
  //     new CustomError("groupId or pipedriveGroupId is required for group call", 400)
  //   );
  // }

  if(!externalUserId) {
    if(!get(Config, "userIdToken")) {
      throw new CustomError("userIdToken is required", 400);
    }
    userId = await getFieldValueOrThrowError(
      message,
      "userIdOnly",
      new CustomError("userId or pipedrivePersonId is required for group call", 400)
    );
  }

  groupPayload = constructPayload(message, groupDataMapping);
  const renameExclusionKeys = Object.keys(groupPayload);

  groupPayload = extractCustomFields(
    message,
    groupPayload,
    ["traits"],
    PIPEDRIVE_GROUP_EXCLUSION,
    true
  );
  
  // should this be added for all custom fields?
  // groupPayload = selectAndFlatten(groupPayload, ["address", "Address"]);

  groupPayload = renameCustomFields(
    groupPayload,
    Config,
    "organizationMap",
    renameExclusionKeys
  );

  groupPayload = removeUndefinedAndNullValues(groupPayload);

  let destGroupId;

  if(externalGroupId) {
    if (get(groupPayload, "add_time")) {
      delete groupPayload.add_time;
    }

    set(groupPayload, Config.groupIdToken, externalGroupId.toString());

    org = await updateOrganisationTraits(externalGroupId, groupPayload, Config);
    destGroupId = externalGroupId;
  } 
  else {
    // search group with custom Id
    org = await searchOrganisationByCustomId(groupId, Config);

    /**
     * if org does not exist, create a new org,
     * else update existing org with new traits
     * throws error if create or udpate fails
     */
    if (!org) {
      if (!get(groupPayload, "name")) {
        throw new CustomError("name is required for new group creation", 400);
      }

      set(groupPayload, Config.groupIdToken, groupId);
      org = await createNewOrganisation(groupPayload, Config);
    } else {
      delete groupPayload.add_time;
      if (Object.keys(groupPayload).length !== 0) {
        org = await updateOrganisationTraits(org.id, groupPayload, Config);
      }
    }

    destGroupId = org.id;
  }

  if (externalUserId) {
    const response = defaultRequestConfig();
    response.body.JSON = {
      org_id: destGroupId
    };
    response.method = defaultPutRequestConfig.requestMethod;
    response.endpoint = `${PERSONS_ENDPOINT}/${externalUserId}`;
    response.params = {
      api_token: Config.apiToken
    };
    response.headers = {
      "Content-Type": "application/json",
      Accept: "application/json"
    };

    return response;
  }

  // if custom userId is provided, search for person
  const person = await searchPersonByCustomId(userId, Config);

  // create user if not found and flag is on
  let personId;
  if(!person) {
    if(Config.enableUserCreation) {
      const personPayload = extractPersonData(message, Config, ["context.traits"]);
      // set userId
      set(personPayload, Config.userIdToken, userId);
      const createdPerson = await createPerson(personPayload, Config);
      personId = createdPerson.id;
    }
    else {
      throw new CustomError("person not found for group call", 400);
    }
  }
  else {
    personId = person.id;
  }

  const response = defaultRequestConfig();
  response.body.JSON = {
    org_id: destGroupId
  };
  response.method = defaultPutRequestConfig.requestMethod;
  response.endpoint = `${PERSONS_ENDPOINT}/${personId}`;
  response.params = {
    api_token: Config.apiToken
  };
  response.headers = {
    "Content-Type": "application/json",
    Accept: "application/json"
  };

  return response;
};

const aliasResponseBuilder = async (message, { Config }) => {
  /**
   * merge previous Id to userId
   * merge id to merge_with_id
   * destination payload structure: { "merge_with_id": "userId"}
   */

  if(!get(Config, "userIdToken")) {
    throw new CustomError("userId token not found, required for alias", 400);
  }

  // extracting all for brevity
  const prevPipedriveId = getDestinationExternalID(message, "pipedrivePreviousId");
  const currPipedriveId = getDestinationExternalID(message, "pipedriveCurrentId");
  const userId = getFieldValueFromMessage(message, "userIdOnly");
  const previousId = getValueFromMessage(message, [
    "previousId",
    "traits.previousId",
    "context.traits.previousId"
  ]);

  let prevId;
  let currId;
  let prevPerson;
  let currPerson;

  if(prevPipedriveId) {
    prevId = prevPipedriveId
    prevPerson = await searchPersonByPipedriveId(prevId, Config);
    if (!prevPerson) {
      throw new CustomError("previous person not found", 400);
    }
  }
  else if(previousId) {
    prevPerson = await searchPersonByCustomId(previousId, Config);
    if(!prevPerson) {
      throw new CustomError("previous user not found", 500);
    }

    prevId = prevPerson.id;
  }
  else {
    throw new CustomError("previous id not found", 400);
  }


  if(currPipedriveId) {
    currId = currPipedriveId
    currPerson = await searchPersonByPipedriveId(currId, Config);
    if (!currPerson) {
      throw new CustomError("current person not found", 500);
    }
  }
  else if (userId) {
    currPerson = await searchPersonByCustomId(userId, Config);
    if (!currPerson) {
      // update the prevPipedriveId user with `userId` as new custom user id

      const response = defaultRequestConfig();
      response.method = defaultPutRequestConfig.requestMethod;
      response.headers = {
        "Content-Type": "application/json",
        Accept: "application/json"
      };
      response.body.JSON = {
        [get(Config, "userIdToken")]: userId
      };
      response.endpoint = `${PERSONS_ENDPOINT}/${prevId}`;
      response.params = {
        api_token: Config.apiToken
      };
      response.body.JSON = {
        [get(Config, "userIdToken")]: userId
      };
      return response;
    }

    currId = currPerson.id;
  }
  else {
    throw new CustomError("userId not found", 400);
  }

  /**
   * if custom userId (current) value is present, merge two persons first
   * and update the userId of the new merged person.
   */
  if (!get(currPerson, Config.userIdToken) && !get(prevPerson, Config.userIdToken)) {
    const response = defaultRequestConfig();
    response.method = defaultPutRequestConfig.requestMethod;
    response.headers = {
      "Content-Type": "application/json",
      Accept: "application/json"
    };
    response.body.JSON = {
      "merge_with_id": currId
    };
    response.endpoint = getMergeEndpoint(prevId);
    response.params = {
      api_token: Config.apiToken
    };
    return response;
  }

  const finalUserId = 
    get(currPerson, Config.userIdToken) || get(prevPerson, Config.userIdToken);

  const mergeResult = await mergeTwoPersons(prevId, currId, Config);
  if(!mergeResult) {
    throw new CustomError("failed to merge persons", 500);
  }

  const response = defaultRequestConfig();
  response.method = defaultPutRequestConfig.requestMethod;
  response.headers = {
    "Content-Type": "application/json",
    Accept: "application/json"
  };
  response.body.JSON = {
    [Config.userIdToken]: finalUserId
  };
  response.endpoint = `${PERSONS_ENDPOINT}/${currId}`;
  response.params = {
    api_token: Config.apiToken
  };
  return response;
};

const trackResponseBuilder = async (message, { Config }) => {
  if (!get(message, "event")) {
    throw new CustomError("event type not specified", 400);
  }

  let pipedrivePersonId = getDestinationExternalID(message, "pipedrivePersonId");

  if (!pipedrivePersonId) {
    if (!get(Config, "userIdToken")) {
      throw new CustomError("userId Token is required", 400);
    }

    const userId = getFieldValueFromMessage(message, "userIdOnly");
    if (!userId) {
      throw new CustomError("userId or pipedrivePersonId required", 400);
    }

    const person = await searchPersonByCustomId(userId, Config);
    if(!person) {
      if(!Config.enableUserCreation) {
        throw new CustomError("person not found, and userCreation is turned off on dashboard", 400);
      }

      // create new person if flag enabled
      const createPayload = extractPersonData(message, Config, ["context.traits"]);
      
      // set userId and timestamp
      set(createPayload, Config.userIdToken, userId);
      set(createPayload, "add_time", getValueFromMessage(message, [
        "traits.add_time", 
        "context.traits.add_time", 
        "originalTimestamp"
      ]));

      const createdPerson = await createPerson(createPayload, Config);
      pipedrivePersonId = createdPerson.id;
    } 
    else {
      pipedrivePersonId = person.id;
    }
  }

  let payload = constructPayload(message, trackDataMapping);
  const renameExclusionKeys = Object.keys(payload);

  payload = extractCustomFields(
    message,
    payload,
    ["properties"],
    PIPEDRIVE_TRACK_EXCLUSION,
    true
  );

  payload = renameCustomFields(
    payload,
    Config,
    "leadsMap",
    renameExclusionKeys
  );

  set(payload, "person_id", pipedrivePersonId);

  /* map price and currency to value object
  * in destination payload
  */
  if (payload.amount && payload.currency) {
    const value = {
      amount: payload.amount,
      currency: payload.currency
    };
    set(payload, "value", value);
  }
  delete payload.amount;
  delete payload.currency;

  const response = defaultRequestConfig();
  response.body.JSON = removeUndefinedAndNullValues(payload);
  response.method = defaultPostRequestConfig.requestMethod;
  response.endpoint = LEADS_ENDPOINT;
  response.params = {
    api_token: Config.apiToken
  };
  response.headers = {
    "Content-Type": "application/json",
    Accept: "application/json"
  };

  return response;
};

const process = async (event) => {
  const { message, destination } = event;
  let builderResponse;

  if (!message.type) {
    throw new CustomError("message type is invalid", 400);
  }

  const messageType = message.type.toLowerCase().trim();
  switch (messageType) {
    case EventType.IDENTIFY:
      builderResponse = await identifyResponseBuilder(
        message,
        destination
      );
      break;
    case EventType.ALIAS:
      builderResponse = await aliasResponseBuilder(
        message,
        destination
      );
      break;
    case EventType.GROUP:
      builderResponse = await groupResponseBuilder(
        message,
        destination
      );
      break;
    case EventType.TRACK:
      builderResponse = await trackResponseBuilder(
        message,
        destination
      );
      break;
    default:
      throw new CustomError("invalid message type", 400);
  }

  return builderResponse
}

const processRouterDest = async inputs => {
  if(!Array.isArray(inputs) || inputs.length === 0) {
    const respEvents = getErrorRespEvents(null, 400, "Invalid events array");
    return [respEvents];
  }

  const respList = await Promise.all(
    inputs.map(async input => {
      try {
        return getSuccessRespEvents(
          await process(input),
          [input.metadata],
          input.destination
        );
      } catch (error) {
        return getErrorRespEvents(
          [input.metadata],
          error.response
            ? error.response.status
            : error.code
            ? error.code
            : 400,
          error.message || "Error occurred while processing event."
        );
      }
    })
  );

  return respList;
};

module.exports = { process, processRouterDest };
