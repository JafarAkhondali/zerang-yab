/**
 * This page will only executed when twitter.com/ANY_USER/following is visited.
 * It will send followings to background page:
 * 	1. userId
 * 	2. userName
 * Then, will add a new tab called "Unfollowers" and retrieves the saves the list in UI
 */

// var is used to be OK with redeclaration of variable
var ZR_COLOR = {
	TWITTER_BLUE: 'rgb(29, 161, 242)',
	RED: 'rgb(168, 7, 26)',
};

/**
 * Searches in dom by textContent
 * Modified version of https://stackoverflow.com/a/37098508/3686236 without regex and accepting dom
 * @param dom
 * @param selector
 * @param text
 * @returns {*[]}
 */
function domContains(dom, selector, text) {
	return Array.prototype.filter.call(dom.querySelectorAll(selector),({textContent}) => {
		return textContent.includes(text) || text.includes(textContent);
	});
}


function getUserId(cookies){
	const userIdCookieIdentifer = "twid=u%3D";
	return cookies.split(';').find(c=>c.trim().startsWith(userIdCookieIdentifer)).substr(userIdCookieIdentifer.length+1);
}

function getUsername(){
	return document.querySelector("a[aria-label='Profile']").href.replace('https://twitter.com/','')
}


function main(){
	// Intervally check until followers list are shown in DOM
	const followersDomReadyCheck = setInterval(() => {
		const followingListDom = document.querySelector('div[aria-label="Timeline: Following"]');
		if (!followingListDom) return;

		// stop interval check
		clearInterval(followersDomReadyCheck);

		browser.runtime.sendMessage({
			action: 'SET_SELF_USER_ID',
			payload: getUserId(document.cookie)
		})

		browser.runtime.sendMessage({
			action: 'SET_SELF_USER_NAME',
			payload: getUsername()
		})

		browser.runtime.sendMessage({
			action: 'GET_FOLLOWERS_NOT_FOLLOWING_BACK',
			payload: getUserId(document.cookie) // TODO: Add support for other people's id
		}).then( ({unfollowers, firstFollowing}) => { // lajana is the list of unfollowers
			console.log('Here?');
			const followingListDom = document.querySelector('[aria-label="Timeline: Following"]');
			const followingTemplate = followingListDom.firstChild.firstChild.cloneNode(true);

			const unfollowersDomHolder = followingListDom.cloneNode();


			// show unfollowers count
			const UnFollowersCounterHolderDom = followingTemplate.firstChild.cloneNode();
			UnFollowersCounterHolderDom.id='unfollowersCounter';
			const unfollowersCounterLabelDom = document.createElement('span');
			unfollowersCounterLabelDom.innerText = 'UnFollowers Count: ';

			const unfollowersCounterDom = document.createElement('span');
			unfollowersCounterDom.innerText = `${unfollowers.length}`;
			UnFollowersCounterHolderDom.append(unfollowersCounterLabelDom, unfollowersCounterDom);

			const templateUser = firstFollowing.content.itemContent.user.legacy;
			// Try to simulate following persons on list
			// Due to uglification of twitter dom, we doms don't have permanent or meaningful id (or classes).
			// We'll update details of the "following user" template with known data of first retrieved user
			const lajanDoms = unfollowers.map( lajan => {
				const userDetails = lajan.content.itemContent.user.legacy;
				// Append user id in user details
				userDetails.id = lajan.content.itemContent.user.rest_id;
				const template = followingTemplate.firstChild.cloneNode(true);

				template.classList.add('unfollower-user');
				// 1. Set image
				// images come in different sizes, we'll replace any found
				try {
					const imageName = templateUser.profile_image_url_https;
					template.querySelector(`[style*='background-image: url("${imageName.replace('normal.jpg','')}']`)
						.style.backgroundImage = `url(${userDetails.profile_image_url_https})`;
				} catch { /*who cares?*/ }

				// 2. Set userId
				const userIdText = `@${templateUser.screen_name}`;
				const userIdDom = domContains(template, `div a[href="/${templateUser.screen_name}"] span`, userIdText)[0];
				userIdDom.textContent = `@${userDetails.screen_name}`;

				// 3. Remove "Follows you" tag, cause that bitch doesn't
				try {
					const followsYouDom = domContains(template, `div a[href="/${templateUser.screen_name}"] span`, "Follows you")[0];
					followsYouDom.parentNode.remove();
				} catch {}

				// 4. Set name
				const usernameDom = domContains(template, 'span', templateUser.name)[0];
				console.log(template, 'span', templateUser.name);
				usernameDom.textContent = userDetails.name;

				// 5. Replace links
				Array.from(template.querySelectorAll('a')).forEach( d => d.href=`/${userDetails.screen_name}`);

				// 6. Apply new inline styles
				template.style.borderLeft = `solid 3px ${ZR_COLOR.RED}`;
				template.style.backgroundColor = 'rgba(168, 7, 26, 0.1)';

				// 7. Apply an onlick to whole dom click
				template.addEventListener('click', () => { window.location.replace(`/${userDetails.screen_name}`)});

				// 8. Replace biography
				try {
					template.querySelectorAll("[dir=auto]")[3].innerText = userDetails.description;
				} catch {
					// TODO: Sometimes template doesn't have a biography, so we'll fail to inject it
				}

				// 9. Mock css styles for unfollow button
				const unfollowBtn = template.querySelector("[data-testid*='-unfollow']");
				const unfollowBtnText = domContains(unfollowBtn, 'span', 'Following')[0];
				const btnWidth = followingListDom.firstChild.firstChild.firstChild
					.querySelector("[data-testid*='-unfollow']").clientWidth*1.1;

				unfollowBtn
					.addEventListener('mouseenter', () => {
						unfollowBtnText.innerText = 'Unfollow';
						unfollowBtn.style.backgroundColor =  ZR_COLOR.RED;
					});

				unfollowBtn
					.addEventListener('mouseleave', () => {
						unfollowBtnText.innerText = 'Following';
						unfollowBtn.style.width = `${btnWidth}px`;
						unfollowBtn.style.backgroundColor =  ZR_COLOR.TWITTER_BLUE;
					});

				unfollowBtn.addEventListener('click', (e)=>{
					e.preventDefault();
					e.stopPropagation();
					browser.runtime.sendMessage({
						action: 'UNFOLLOW_BY_USER_ID',
						payload: userDetails.id,
					}).then(()=> {
						unfollowBtn.style.display = 'none';
						// TODO: Add Re-follow functionality later (who follows that bitch anyway)
						// NVM, JUST ANIMATE KICKING THAT BITCH OUT
						template.classList.add('animate__animated', 'animate__hinge');
						template.style.setProperty('--animate-duration', '0.85s');
						template.addEventListener('animationend', () => {
							template.style.display='none';
							unfollowersCounterDom.innerText = Number(unfollowersCounterDom.innerText)-1;
						});
					});
					return false;
				});
				return template;
			});

			unfollowersDomHolder.append(UnFollowersCounterHolderDom);
			unfollowersDomHolder.append(...lajanDoms);
			followingListDom.parentNode.prepend(unfollowersDomHolder);
			console.log('Done');

		}).then(()=>{
			browser.runtime.sendMessage({
				action: 'ACTIVATE_UNFOLLOW_CATCHER',
				payload: true,
			}).then( ()=> {
				const followingListDom = document.querySelector('[aria-label="Timeline: Following"]:last-child');
				// Craft a fake unfollow to find headers ( which will be done in BG)
				const unfollowBtn = followingListDom.firstChild.firstChild.querySelector('[data-testid*="-unfollow"]');
				unfollowBtn.click(); // simulate click on unfollow btn
				// simulate click modal
				document.querySelector('[data-testid="confirmationSheetConfirm"]').click();
				// from this points, unfollow actions will be processed
			});
		});



	},185);
}


if (document.readyState === 'loading') {
	// still loading, wait for the event
	document.addEventListener('DOMContentLoaded', main);
} else {
	// DOM is ready!
	main();
}
