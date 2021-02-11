const GRAPHQL_ENDPOINT = 'https://twitter.com/i/api/graphql/';
const UNFOLLOW_URL = 'https://twitter.com/i/api/1.1/friendships/destroy.json';
const PAGINATION_SIZE = 100;
const USER_AGENT_TAIL = '00000';
const GRAPHQL_FOLLOWING_URL_REGEX = /https:\/\/twitter\.com\/i\/api\/graphql\/(.*)\/Following\?variables=.*/;
const FOLLOWING_URL_REGEX = /https:\/\/twitter\.com\/.*\/following/;
const UNFOLLOW_USER_URL = 'https://twitter.com/i/api/1.1/friendships/destroy.json';

//include_profile_interstitial_type=1&include_blocking=1&include_blocked_by=1&include_followed_by=1&include_want_retweets=1&include_mute_edge=1&include_can_dm=1&include_can_media_tag=1&skip_status=1&id=2427824223
const user = {
    id: null,
    username: null,
};
let randomPart = null, unfollowActivate = false;

const graphqlHeadersForGetFollowing = {};
const graphqlHeadersForUnfollowing = {};

function setSelfUserId(userId) {
    user.id = userId;
}

function setSelfUsername(username) {
    user.username = username;
}

async function getFollowings(headers, userId, randomPart, cursor) {
    const payload = {
        count: PAGINATION_SIZE,
        includePromotedContent: false,
        userId,
        withHighlightedLabel: false,
        withTweetQuoteCount: false,
        withTweetResult: false,
        withUserResult: false,
    };
    if (cursor) payload.cursor = cursor;

    const url = `${GRAPHQL_ENDPOINT}${randomPart}/Following?variables=${encodeURIComponent(JSON.stringify(payload))}`;
    const response = await fetch(url, {
        cache: 'no-cache',
        credentials: 'include',
        headers,
        redirect: 'follow', // manual, *follow, error
    });

    /**
     * The response scheme contains:
     * 1. users in maximum length of requested pagination size
     * 2. the top paginator
     * 3. the bottom pagination
     */
    return response.json();
}

async function getFollowersNotFollowingBack(userId) {
    let unfollowers = [];
    let lastRetrievedCursor = null, firstFollowing;
    //TODO: iterate and map data

    for (let nextValue = 1; nextValue>0;) { // i did ... what are you gonna do about it
        const followingsResponseChunk = await getFollowings(graphqlHeadersForGetFollowing, userId, randomPart, lastRetrievedCursor);
        const { entries: followingChunkEntry } = followingsResponseChunk.data.user.following_timeline.timeline
            .instructions
            .find(({type}) => type === 'TimelineAddEntries');
        const [ bottomCursor, topCursor ] = followingChunkEntry.splice(-2);

        // we'll need to pass first following users later
        if(nextValue === 1 ) firstFollowing = followingChunkEntry[0];

        unfollowers = unfollowers.concat(
            followingChunkEntry.filter(u=> !u.content.itemContent.user.legacy.followed_by) // filter lajans only
        );
        nextValue = Number(bottomCursor.content.value.split("|")[0]);
        lastRetrievedCursor = bottomCursor.content.value;
    }
    return { unfollowers, firstFollowing };
}



async function unfollowUser(headers, userId) {
    const payload = {
        include_profile_interstitial_type: 1,
        include_blocking: 1,
        include_blocked_by: 1,
        include_followed_by: 1,
        include_want_retweets: 1,
        include_mute_edge: 1,
        include_can_dm: 1,
        include_can_media_tag: 1,
        skip_status: 1,
        id: userId,
    };
    const body = Object.entries(payload)
        .map(([key, val]) => `${ encodeURIComponent(key)}=${encodeURIComponent(val)}`).join('&');
    const response = await fetch(UNFOLLOW_USER_URL, {
        cache: 'no-cache',
        credentials: 'include',
        headers,
        redirect: 'follow', // manual, *follow, error
        method: 'POST',
        body,
    });

    return response.json();
}

browser.runtime.onMessage.addListener((request, sender, sendResponse)=> {
    const runtimeMessageHandler =  {
        'SET_SELF_USER_ID': setSelfUserId,
        'SET_SELF_USER_NAME': setSelfUsername,
        'GET_FOLLOWERS_NOT_FOLLOWING_BACK': getFollowersNotFollowingBack,
        'UNFOLLOW_BY_USER_ID': (userId)=> { return unfollowUser(graphqlHeadersForUnfollowing, userId)},
        'ACTIVATE_UNFOLLOW_CATCHER': (value) => { unfollowActivate = value }
    }
    // Commit action
    return runtimeMessageHandler[request.action](request.payload);
});


// Listen on sent api of any request to graphql to retrieve essential parts of request and cookies
browser.webRequest.onBeforeSendHeaders.addListener((data) => {
        const urlParts = data.url.match(GRAPHQL_FOLLOWING_URL_REGEX);
        // Make sure the request is going to following endpoint
        if (!urlParts) return;

        // Since we'll send almost exact request in webextension, we should distinguish our requests from the browser
        // as a workaround, we'll send extra Zero tails in useragent browser version
        const isExtensionRequest = data.requestHeaders
            .find(({name}) => name === 'User-Agent').value.endsWith(USER_AGENT_TAIL);
        if(isExtensionRequest) return;

        data.requestHeaders.map(({name, value}) => graphqlHeadersForGetFollowing[name] = value);
        graphqlHeadersForGetFollowing['User-Agent'] += USER_AGENT_TAIL;

        // Set random part in graphql URL
        randomPart = urlParts[1];

    },
    {'urls': [`${GRAPHQL_ENDPOINT}*`]}, // limit listener on twitter graphql
    ['requestHeaders']
);

// Listen on the first manually crafted request for unfollow, to find the needed headers
browser.webRequest.onBeforeSendHeaders.addListener((request) => {
        console.log('In canceling', request);
        // We want to find our crafted request and should allow other requests

        if ( !unfollowActivate ) return { cancel: false};
        unfollowActivate = false;
        request.requestHeaders.map(({name, value}) => graphqlHeadersForUnfollowing[name] = value);

        // this is a bad hack,
        // instead of canceling, send invalid request header, cause on failure, chrome retries request !
        return {requestHeaders: request.requestHeaders.map(header=> {
                return {
                    name: header.name,
                    value: '',
                }
            })};
    },
    {'urls': [UNFOLLOW_URL] }, // limit listener on twitter graphql
    ['requestHeaders', 'blocking']
);

// Due to a bug in webextension(https://github.com/mdn/content/issues/2131), we'll have to inefficiently detect url
browser.tabs.onUpdated.addListener((tabId, changeInfo, tab)=>{

        const possibleUrl = changeInfo.url || changeInfo.title;
        if(!(possibleUrl && possibleUrl.match(FOLLOWING_URL_REGEX))) return;

        // Wait over time until randomPart is filled
        let intervalId = setInterval(async () => {
            if (!randomPart) return;

            clearInterval(intervalId);

            await browser.tabs.executeScript({file: "browser-polyfill.js"});
            await browser.tabs.executeScript({file: "/src/inject/inject.js"});
            await browser.tabs.insertCSS({file: "/src/inject/inject.css"});
            console.log('INJECTED');
        }, 100);
    }
);
